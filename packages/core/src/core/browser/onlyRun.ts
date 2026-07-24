import {
  createCoverageProvider,
  createCoverageProviderWithLog,
  logCoverageEnabled,
} from '../../coverage';
import { buildBrowserCoverageMap } from '../../coverage/browserCoverageMap';
import type { ProjectContext } from '../../types';
import {
  color,
  logger,
  resolveShardedEntries,
  type TraceController,
  type TraceRun,
} from '../../utils';
import { FATAL_SIGNALS, getSignalExitCode } from '../../utils/signals';
import {
  globalSetupFailureOutcome,
  runBrowserGlobalSetupStage,
} from './globalSetupStage';
import { loadBrowserExecutor, runBrowserModeTests } from './loader';
import { attachBrowserWatchControls } from './watchControls';
import { ensureRunDependencies } from '../dependencies';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunEnd,
  notifyReportersOnTestRunStart,
  reportNoTestFiles,
  runLifecycleStep,
} from '../finalizeRun';
import { runGlobalTeardown } from '../globalSetup';
import type { Rstest } from '../rstest';

/**
 * Browser-only run path (no node projects). Retained per the cold-start gate:
 * constructing/`init()`-ing a NodeExecutor would add the node Rsbuild instance
 * to every pure-browser run.
 *
 * Watch runs stay host-driven and self-finalizing (with a bespoke coverage
 * report after the session exits); non-watch runs drive one browser executor
 * through the shared finalize so exit code, reporter output, coverage, and the
 * no-test path match node and mixed runs.
 */
export async function runBrowserOnlyTests(
  context: Rstest,
  browserProjects: ProjectContext[],
  {
    traceController,
    traceRun,
  }: {
    traceController: TraceController;
    /**
     * The run buffer pre-allocated by the orchestrator — reused as this path's
     * trace run so it never becomes a dead, never-finalized twin.
     */
    traceRun: TraceRun;
  },
): Promise<void> {
  const isWatchMode = context.command === 'watch';
  const { coverage } = context.normalizedConfig;
  const { snapshotManager } = context;

  if (context.relatedResolutionEmpty) {
    if (isWatchMode) {
      const emptyWatchResult = await runBrowserModeTests(
        context,
        browserProjects,
        {
          allowEmptyWatchRun: true,
        },
      );
      await attachBrowserWatchControls(context, emptyWatchResult?.watch);
    } else {
      reportNoTestFiles({ context });
      await notifyReportersOnTestRunEnd({
        context,
        duration: { totalTime: 0, buildTime: 0, testTime: 0 },
        getSourcemap: async () => null,
      });
    }

    await runLifecycleStep('trace controller cleanup', () =>
      traceController.close(),
    );
    return;
  }

  await ensureRunDependencies({
    projects: [],
    rootPath: context.rootPath,
    coverage,
  });

  if (isWatchMode) {
    if (coverage.enabled) {
      logCoverageEnabled(coverage);
    }
    // Browser-only watch: the host owns per-rerun finalize. The bespoke
    // coverage report runs once after the watch session exits (Phase 6
    // converges this onto the executor seam).
    const browserResult = await runBrowserModeTests(context, browserProjects, {
      onTraceEvents: traceRun.onEvents,
    });

    if (
      coverage.enabled &&
      browserResult?.results.length &&
      !browserResult.unhandledErrors?.length
    ) {
      const coverageProvider = await createCoverageProvider(
        coverage,
        context.rootPath,
      );
      const browserCoverageMap = buildBrowserCoverageMap(
        browserResult.results,
        coverageProvider,
      );
      if (coverageProvider && browserCoverageMap) {
        const { generateCoverage } = await import('../../coverage/generate');
        await generateCoverage(
          context,
          browserCoverageMap,
          coverageProvider,
          traceRun.span,
        );
      }
    }

    await attachBrowserWatchControls(context, browserResult?.watch);
  } else {
    const coverageProvider = await createCoverageProviderWithLog(
      coverage,
      context.rootPath,
    );
    // Resolve the shard once (undefined when unsharded) and share it between
    // the executor construction and the setup gate so they cannot disagree on
    // which files run — the host's own shard fallback only fires on the
    // config-hook refresh path, not on initial resolution.
    const browserShardedEntries = await resolveShardedEntries(context, {
      silent: true,
    });
    const browserExecutor = await loadBrowserExecutor(
      context,
      browserProjects,
      coverageProvider,
      { shardedEntries: browserShardedEntries },
    );
    await browserExecutor.init();

    await notifyReportersOnTestRunStart(context);
    // Best-effort teardown nets for hard crashes and signal deaths between
    // setup and teardown (parity with the mixed path's handlers); the
    // deterministic drain in the `finally` below is the primary guarantee.
    // Registered only when a setup actually ran — failed setups never queue
    // teardown callbacks, so there is nothing to drain for them.
    const teardownOnExit = () => {
      runGlobalTeardown(context).catch((error) => {
        logger.log(color.red(`Error in global teardown: ${error}`));
      });
    };
    const teardownOnSignal = (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      runGlobalTeardown(context)
        .catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        })
        .finally(() => {
          process.exit(getSignalExitCode(signal));
        });
    };
    try {
      const stage = await runBrowserGlobalSetupStage(context, browserProjects, {
        entriesCache: browserShardedEntries,
      });
      if (!context.embedded && stage.env !== undefined) {
        process.on('exit', teardownOnExit);
        for (const signal of FATAL_SIGNALS) {
          process.on(signal, teardownOnSignal);
        }
      }
      const outcome = stage.errors.length
        ? globalSetupFailureOutcome(stage.errors)
        : await browserExecutor.runCycle({
            buildId: 1,
            mode: 'all',
            updateSnapshot: snapshotManager.options.updateSnapshot,
            env: stage.env,
            onTraceEvents: traceRun.onEvents,
          });
      await finalizeRunCycle(context, {
        outcomes: [outcome],
        mode: 'all',
        isWatchMode: false,
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun,
      });
    } finally {
      try {
        await runLifecycleStep('global teardown', () =>
          runGlobalTeardown(context),
        );
      } finally {
        // The executor close must survive a throwing teardown — a skipped
        // close leaks the launched browser and dev servers. `process.off`
        // on a never-registered listener is a no-op.
        process.off('exit', teardownOnExit);
        for (const signal of FATAL_SIGNALS) {
          process.off(signal, teardownOnSignal);
        }
        await runLifecycleStep('executor cleanup', () =>
          browserExecutor.close(),
        );
      }
    }
  }

  await runLifecycleStep('trace shutdown', () =>
    traceController.shutdown(traceRun),
  );
}
