import { createCoverageProviderWithLog } from '../../coverage';
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
import { loadBrowserExecutor } from './loader';
import { ensureRunDependencies } from '../dependencies';
import { isCliShortcutsEnabled, setupCliShortcuts } from '../cliShortcuts';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunEnd,
  notifyReportersOnTestRunStart,
  reportNoTestFiles,
  runLifecycleStep,
} from '../finalizeRun';
import { runGlobalTeardown } from '../globalSetup';
import type { Rstest } from '../rstest';
import {
  createWatchCycleDriver,
  createWatchShortcutHandlers,
  createWatchTeardown,
  registerWatchSignalExit,
} from '../watchSession';

/**
 * The browser-only watch session: one executor, driven by the same core loop as
 * every other watch shape. The executor's own triggers (dev rebuild, HMR, the
 * in-page rerun button) signal back into it, and the CLI shortcuts fan out to
 * it — `t`/`p` have no browser callback, so those keys render greyed hints.
 *
 * Returns once the initial cycle has finalized; the session itself outlives the
 * call and is torn down through the shared teardown.
 */
async function runBrowserOnlyWatch(
  context: Rstest,
  browserProjects: ProjectContext[],
  traceController: TraceController,
  initialTraceRun: TraceRun,
): Promise<void> {
  const coverageProvider = await createCoverageProviderWithLog(
    context.normalizedConfig.coverage,
    context.rootPath,
  );
  const browserExecutor = await loadBrowserExecutor(
    context,
    browserProjects,
    coverageProvider,
  );
  await browserExecutor.init();

  let activeTraceRun = initialTraceRun;
  const enableCliShortcuts = isCliShortcutsEnabled();
  const watchDriver = createWatchCycleDriver({
    context,
    coverageProvider,
    traceController,
    getTraceRun: () => activeTraceRun,
    setTraceRun: (traceRun) => {
      activeTraceRun = traceRun;
    },
    enableCliShortcuts,
    isSessionLive: () => browserExecutor.hasWatchSession(),
  });
  // The host resolves the rerun scope before it signals (its file-set diff is
  // consumed once), so the hint's filters are the scope this trigger asked for —
  // the cycle's own is that, plus whatever any signal folded into it.
  browserExecutor.onInvalidate(({ fileFilters }) =>
    watchDriver.runCycle(browserExecutor, {
      mode: 'on-demand',
      fileFilters,
      fromInvalidation: true,
    }),
  );

  const closeWatchSession = createWatchTeardown({
    executors: [browserExecutor],
    traceController,
    getTraceRun: () => activeTraceRun,
  });
  registerWatchSignalExit(context, closeWatchSession);
  const { onBeforeRestart } = await import('../restart');
  onBeforeRestart(closeWatchSession);

  // Installed before the first cycle so the ready banner can never appear
  // before stdin has an owner — a keystroke answering it would be swallowed.
  if (enableCliShortcuts) {
    const closeCliShortcuts = await setupCliShortcuts(
      createWatchShortcutHandlers(
        context,
        {
          browser: {
            rerun: (testPaths) => browserExecutor.requestRerun(testPaths),
          },
        },
        closeWatchSession,
        () => watchDriver.hasSettledCycle([browserExecutor]),
      ),
    );
    onBeforeRestart(closeCliShortcuts);
  }

  await watchDriver.runCycle(browserExecutor, { mode: 'all' });
}

/**
 * Browser-only run path (no node projects). Retained per the cold-start gate:
 * constructing/`init()`-ing a NodeExecutor would add the node Rsbuild instance
 * to every pure-browser run.
 *
 * Both commands drive one browser executor through the shared finalize, so exit
 * code, reporter output, coverage, and the no-test path match node and mixed
 * runs. Watch differs only in that the executor stays alive after the first
 * cycle, which is why its session owns the trace controller's shutdown instead
 * of the one-shot tail below.
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
  const { coverage } = context.normalizedConfig;
  const { snapshotManager } = context;

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

  if (context.command === 'watch') {
    await runBrowserOnlyWatch(
      context,
      browserProjects,
      traceController,
      traceRun,
    );
    return;
  }

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
      await runLifecycleStep('executor cleanup', () => browserExecutor.close());
    }
  }

  await runLifecycleStep('trace shutdown', () =>
    traceController.shutdown(traceRun),
  );
}
