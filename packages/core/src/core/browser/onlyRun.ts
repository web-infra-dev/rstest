import {
  createCoverageProviderWithLog,
  logCoverageEnabled,
} from '../../coverage';
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
  type BrowserGlobalSetupStageResult,
  globalSetupFailureOutcome,
  runBrowserGlobalSetupStage,
} from './globalSetupStage';
import { loadBrowserExecutor, runBrowserModeTests } from './loader';
import {
  attachBrowserWatchShortcuts,
  createBrowserWatchLifecycle,
  registerWatchSignalExit,
  reportInitialCycleCoverage,
  reportBrowserWatchGlobalSetupFailure,
} from './watchControls';
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
 * Watch runs stay host-driven and self-finalizing — the first cycle reports
 * coverage here, every rerun reports through the host's per-rerun finalize;
 * non-watch runs drive one browser executor through the shared finalize so exit
 * code, reporter output, coverage, and the no-test path match node and mixed
 * runs.
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
  let traceShutdownPromise: Promise<void> | undefined;
  const shutdownTrace = (): Promise<void> => {
    traceShutdownPromise ??= runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(traceRun),
    );
    return traceShutdownPromise;
  };

  // Related runs are rejected in watch mode at the CLI, so an empty related
  // resolution is always a one-shot run that ends right here.
  if (context.relatedResolutionEmpty) {
    reportNoTestFiles({ context });
    await notifyReportersOnTestRunEnd({
      context,
      duration: { totalTime: 0, buildTime: 0, testTime: 0 },
      getSourcemap: async () => null,
    });

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
    const browserShardedEntries = await resolveShardedEntries(context, {
      silent: true,
    });
    let browserResult: Awaited<ReturnType<typeof runBrowserModeTests>>;
    const lifecycle = createBrowserWatchLifecycle(() => browserResult?.watch);
    lifecycle.addControlCleanup(
      registerWatchSignalExit(context, lifecycle.close),
    );
    const { onBeforeRestart } = await import('../restart');
    onBeforeRestart(async () => {
      await lifecycle.close();
      await shutdownTrace();
    });

    let stage: BrowserGlobalSetupStageResult;
    try {
      stage = await lifecycle.track(
        runBrowserGlobalSetupStage(context, browserProjects, {
          entriesCache: browserShardedEntries,
        }),
      );
    } catch (error) {
      const wasClosing = lifecycle.isClosing();
      await lifecycle.close();
      if (wasClosing) {
        return;
      }
      await shutdownTrace();
      throw error;
    }
    if (lifecycle.isClosing()) {
      return;
    }

    if (stage.errors.length) {
      try {
        await reportBrowserWatchGlobalSetupFailure(context, stage.errors);
      } finally {
        await lifecycle.close();
        await shutdownTrace();
      }
      throw new AggregateError(stage.errors, 'Browser globalSetup failed');
    }

    // Browser-only watch: the host owns per-rerun finalize, so the initial
    // cycle's coverage is reported here — reruns report through the host's
    // `finalizeWatchRerun` → `finalizeRunCycle`.
    try {
      browserResult = await lifecycle.track(
        runBrowserModeTests(context, browserProjects, {
          shardedEntries: browserShardedEntries,
          env: stage.env,
          onTraceEvents: traceRun.onEvents,
        }).then(async (result) => {
          browserResult = result;
          await reportInitialCycleCoverage(context, result, traceRun.span);
          return result;
        }),
      );

      if (lifecycle.isClosing()) {
        await lifecycle.close();
      } else if (browserResult?.watch) {
        await lifecycle.track(
          attachBrowserWatchShortcuts(context, {
            ...browserResult.watch,
            close: lifecycle.close,
          }).then((cleanupControls) => {
            lifecycle.addControlCleanup(cleanupControls);
          }),
        );
      } else {
        await lifecycle.close();
      }
    } catch (error) {
      const wasClosing = lifecycle.isClosing();
      await lifecycle.close();
      if (!wasClosing) {
        await shutdownTrace();
        throw error;
      }
    }
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
      runGlobalTeardown().catch((error) => {
        logger.log(color.red(`Error in global teardown: ${error}`));
      });
    };
    const teardownOnSignal = (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      runGlobalTeardown()
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
        await runLifecycleStep('global teardown', () => runGlobalTeardown());
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

  await shutdownTrace();
}
