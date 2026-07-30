import {
  cleanCoverageReports,
  createCoverageProviderWithLog,
} from '../coverage';
import { ensureRunDependencies } from './dependencies';
import type { TestExecutor } from '../types';
import {
  color,
  createTraceController,
  getForceRerunTriggerMessage,
  logger,
  type TraceEvent,
} from '../utils';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunStart,
  runLifecycleStep,
} from './finalizeRun';
import {
  type BrowserTestExecutor,
  loadBrowserExecutor,
} from './browser/loader';
import { FATAL_SIGNALS, getSignalExitCode } from '../utils/signals';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import {
  type BrowserGlobalSetupStageResult,
  globalSetupFailureOutcome,
  runBrowserGlobalSetupStage,
} from './browser/globalSetupStage';
import { runBrowserOnlyTests } from './browser/onlyRun';
import { createBrowserRunPlanner } from './browser/runPlanner';
import {
  type CreateNodeExecutorOptions,
  createNodeExecutor,
  type NodeRunPlanAccess,
} from './executors/nodeExecutor';
import { runGlobalTeardown } from './globalSetup';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import type { Rstest } from './rstest';
import {
  createWatchCycleDriver,
  createWatchShortcutHandlers,
  createWatchTeardown,
  registerWatchSignalExit,
  type WatchSessionTargets,
} from './watchSession';

/**
 * What the orchestrator drives on the node side: the shared executor seam plus
 * the named plan-access surface — never the concrete `NodeExecutor`. Watch
 * subscribes to invalidations, so `onInvalidate` (optional on the seam, for
 * executors with no watch trigger of their own) is required of the node side
 * here.
 */
type OrchestratedNodeExecutor = TestExecutor &
  NodeRunPlanAccess &
  Required<Pick<TestExecutor, 'onInvalidate'>>;

/**
 * The collaborators `runTests` orchestrates, injected rather than imported at
 * the call sites so the run loop can be driven with fake executors in unit
 * tests (the browser loader `process.exit(1)`s on a missing `@rstest/browser`,
 * and the CLI shortcuts take over the process's stdin — neither may be reached
 * from a test).
 */
export interface RunTestsDeps {
  createNodeExecutor: (
    context: Rstest,
    options: CreateNodeExecutorOptions,
  ) => OrchestratedNodeExecutor;
  loadBrowserExecutor: typeof loadBrowserExecutor;
  createBrowserRunPlanner: typeof createBrowserRunPlanner;
  runBrowserOnlyTests: typeof runBrowserOnlyTests;
  runBrowserGlobalSetupStage: typeof runBrowserGlobalSetupStage;
  isCliShortcutsEnabled: typeof isCliShortcutsEnabled;
  setupCliShortcuts: typeof setupCliShortcuts;
  createTraceController: typeof createTraceController;
}

const productionDeps: RunTestsDeps = {
  createNodeExecutor,
  loadBrowserExecutor,
  createBrowserRunPlanner,
  runBrowserOnlyTests,
  runBrowserGlobalSetupStage,
  isCliShortcutsEnabled,
  setupCliShortcuts,
  createTraceController,
};

export async function runTests(
  context: Rstest,
  deps: RunTestsDeps = productionDeps,
): Promise<void> {
  // High-level flow (post-executor-seam):
  // 1. Split browser/node projects (the single `isBrowserProject` predicate).
  // 2. Browser-only runs (no node projects) take a fast path so they skip the
  //    node Rsbuild server + worker pool entirely (cold-start gate: retained).
  // 3. Otherwise construct a `NodeExecutor`, `init()` it (its `modifyRstestConfig`
  //    hooks fire and the plan resolves — the init barrier), then construct a
  //    `BrowserExecutor` from the resolved plan.
  // 4. Non-watch: `Promise.all(executors.map(e => e.runCycle()))` → one
  //    `finalizeRunCycle` → one `executors.close()` exit path.
  // 5. Watch: both executors signal through `onInvalidate` and every signal is
  //    one queued cycle + finalize, so node rebuilds, browser rebuilds, and CLI
  //    shortcuts all run through the same loop.
  cleanCoverageReports(context.normalizedConfig.coverage);

  if (context.relatedRerunReason === 'forceRerunTrigger') {
    logger.log(`${color.yellow(getForceRerunTriggerMessage(context))}\n`);
  }

  const browserProjects = context.projects.filter(isBrowserProject);
  const nodeProjects = context.projects.filter(isNodeProject);

  const hasBrowserProjects = browserProjects.length > 0;
  const hasNodeProjects = nodeProjects.length > 0;

  const isWatchMode = context.command === 'watch';

  // Reset the per-run test state once, before any executor streams events into
  // `stateManager`. Watch cycles own their own reset via
  // `prepareWatchCycleState`.
  if (!isWatchMode) {
    context.stateManager.reset();
  }

  // `onlyFailures` applies only to a plain, full run; every other scoping
  // mechanism wins over failure history. Warn once and ignore (rather than
  // erroring) so a shared config carrying `onlyFailures` stays usable everywhere.
  if (context.normalizedConfig.onlyFailures) {
    if (isWatchMode) {
      logger.warn(
        'onlyFailures is ignored in watch mode; use the watch run-failed shortcut instead.',
      );
    } else if (context.relatedMode) {
      logger.warn(
        `onlyFailures is ignored when combined with --${context.relatedMode}.`,
      );
    } else if (context.fileFilters?.length) {
      logger.warn(
        'onlyFailures is ignored when explicit file filters are provided.',
      );
    } else if (context.normalizedConfig.testNamePattern) {
      logger.warn(
        'onlyFailures is ignored when a test name pattern is provided.',
      );
    }
  }

  const { coverage } = context.normalizedConfig;
  const { rootPath, snapshotManager } = context;

  // Constructed before the browser-only fast path so `--trace` is honored for
  // pure-browser runs (browser host forwards events via `onTraceEvents`).
  const traceController = deps.createTraceController({
    enabled: context.trace,
    rootPath: context.rootPath,
  });
  // Pre-allocated so browser events emitted before a cycle adopts a fresh buffer
  // (or in filtered runs where no cycle runs) are not silently dropped.
  let activeTraceRun = traceController.beginRun();
  const forwardBrowserTraceEvents = context.trace
    ? (events: TraceEvent[]) => activeTraceRun.onEvents?.(events)
    : undefined;

  // ===================================================================
  // Browser-only fast path (no node projects). Retained per the cold-start
  // gate: constructing/`init()`-ing a NodeExecutor here would add the node
  // Rsbuild instance to every pure-browser run — and with zero node projects
  // that instance resolves to an empty `environments: {}` anyway.
  // ===================================================================
  if (hasBrowserProjects && !hasNodeProjects) {
    await deps.runBrowserOnlyTests(context, browserProjects, {
      traceController,
      // The pre-allocated run buffer above is the fast path's trace run — a
      // second `beginRun()` would leave it as a dead, never-finalized twin.
      traceRun: activeTraceRun,
    });
    return;
  }

  // ===================================================================
  // Mixed / node path. Init barrier: node executor first (hooks fire, plan
  // resolves), then the browser executor from the resolved plan.
  // ===================================================================
  const nodeExecutor = deps.createNodeExecutor(context, {
    browserProjects,
    nodeProjects,
    isWatchMode,
    getTraceRun: () => activeTraceRun,
  });
  await nodeExecutor.init();

  // Browser-side planning (filter classification, config-hook discovery, run
  // option bags) lives behind the planner so only the coarse flow stays here.
  const planner = deps.createBrowserRunPlanner({
    context,
    nodeExecutor,
    browserProjects,
    nodeProjects,
    onTraceEvents: forwardBrowserTraceEvents,
  });
  await planner.runConfigHookDiscovery();

  const hasNodeTestsToRun = nodeExecutor.hasNodeTestsToRun();
  const hasBrowserTestsToRun = planner.hasBrowserTestsToRun();

  if (hasNodeTestsToRun || hasBrowserTestsToRun) {
    await ensureRunDependencies({ projects: [], rootPath, coverage });
    const coveragePluginLoadError = nodeExecutor.coveragePluginLoadError();
    if (coveragePluginLoadError) {
      throw coveragePluginLoadError;
    }
  }

  // Nothing to run on either side: route the empty run through the shared
  // finalize like every other non-watch path.
  if (!hasNodeTestsToRun && !hasBrowserTestsToRun) {
    // A coverage-plugin load error is only thrown when something actually runs
    // (above); on the empty path it just means no provider can be built.
    const coverageProvider = nodeExecutor.coveragePluginLoadError()
      ? null
      : await createCoverageProviderWithLog(coverage, rootPath);
    await finalizeRunCycle(context, {
      outcomes: [],
      mode: 'all',
      isWatchMode,
      coverageProvider,
      reportOnFailure: coverage.reportOnFailure,
      traceRun: activeTraceRun,
    });
    await runLifecycleStep('executor cleanup', () => nodeExecutor.close());
    await runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(activeTraceRun),
    );
    return;
  }

  const coverageProvider = await createCoverageProviderWithLog(
    coverage,
    rootPath,
  );
  nodeExecutor.setCoverageProvider(coverageProvider);

  // ===================================================================
  // Non-watch: one executor loop, one finalize, one close exit path.
  // ===================================================================
  if (!isWatchMode) {
    // Start the node resources (dev server, env-dependency validation, pool)
    // BEFORE constructing the browser executor, so an early node dependency
    // failure (e.g. missing `jsdom`) never leaves a browser host mid-launch —
    // the same deliberate ordering the pre-seam code had. The build/stats phase
    // inside `runCycle` still overlaps with the browser run below.
    if (hasNodeTestsToRun) {
      await nodeExecutor.ensureRunResources();
    }

    const executors: TestExecutor[] = hasNodeTestsToRun ? [nodeExecutor] : [];

    // Single-exit-path rule: every executor closes through here exactly once
    // (idempotent), so no early return or throw can reintroduce a #1363-class
    // deferred-teardown hang. `executors` is read at close time, so the browser
    // executor pushed inside the try below is covered — including when its own
    // load/init fails with the node resources above already up.
    let didCloseExecutors = false;
    const closeExecutors = async () => {
      if (didCloseExecutors) {
        return;
      }
      didCloseExecutors = true;
      try {
        await Promise.all(
          executors.map((executor) =>
            runLifecycleStep('executor cleanup', () => executor.close()),
          ),
        );
      } finally {
        // `executors` excludes the node executor when only browser tests run,
        // so `NodeExecutor.close()` alone cannot drain the browser stage's
        // setups. A second drain is a no-op, and it must run even when an
        // executor close throws.
        await runLifecycleStep('global teardown', () => runGlobalTeardown());
      }
    };

    let isTeardown = false;
    let isCleaningUp = false;
    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;
      try {
        await closeExecutors();
        await runLifecycleStep('trace run finalize', () =>
          activeTraceRun.finalize(),
        );
        await runLifecycleStep('trace controller cleanup', () =>
          traceController.close(),
        );
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const unExpectedExit = (code?: number) => {
      if (isTeardown) {
        logger.log(
          color.yellow(
            `Rstest exited unexpectedly with code ${code}, this is likely caused by test environment teardown.`,
          ),
        );
      } else {
        logger.log(
          color.red(
            `Rstest exited unexpectedly with code ${code}, terminating test run.`,
          ),
        );
        runGlobalTeardown().catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        });
        process.exitCode = 1;
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      process.exit(getSignalExitCode(signal));
    };

    if (!context.embedded) {
      process.on('exit', unExpectedExit);
      for (const signal of FATAL_SIGNALS) {
        process.on(signal, handleSignal);
      }
    }

    try {
      let browserStage: BrowserGlobalSetupStageResult = { errors: [] };
      let browserExecutor: TestExecutor | undefined;
      if (hasBrowserTestsToRun) {
        const browserProjectsToRun = planner.getBrowserProjectsToRun();
        browserExecutor = await deps.loadBrowserExecutor(
          context,
          browserProjectsToRun,
          coverageProvider,
          planner.getExecutorRunOptions(browserProjectsToRun),
        );
        executors.push(browserExecutor);
        await browserExecutor.init();
        // Core-owned pre-cycle globalSetup stage over the resolved browser
        // subset. It mutates the shared host `process.env`, so browser setups'
        // env changes are also visible to node workers dispatched below.
        browserStage = await deps.runBrowserGlobalSetupStage(
          context,
          browserProjectsToRun,
          { entriesCache: nodeExecutor.getPlan().entriesCache },
        );
      }

      await notifyReportersOnTestRunStart(context);
      // Settle every cycle before propagating a failure: a fail-fast
      // `Promise.all` would reach the `finally` teardown while a sibling
      // executor is still mid-cycle, truncating its tests and firing global
      // teardown early. The re-await unwraps the already-settled promises,
      // rejecting with the first failure in executor order.
      const cyclePromises = executors.map((executor) =>
        executor === browserExecutor && browserStage.errors.length
          ? Promise.resolve(globalSetupFailureOutcome(browserStage.errors))
          : executor.runCycle({
              buildId: 1,
              mode: 'all',
              updateSnapshot: snapshotManager.options.updateSnapshot,
              env: browserStage.env,
              onTraceEvents: forwardBrowserTraceEvents,
            }),
      );
      await Promise.allSettled(cyclePromises);
      const outcomes = await Promise.all(cyclePromises);

      await finalizeRunCycle(context, {
        outcomes,
        mode: 'all',
        isWatchMode: false,
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun: activeTraceRun,
      });
      isTeardown = true;
    } finally {
      try {
        await closeExecutors();
      } finally {
        if (!context.embedded) {
          process.off('exit', unExpectedExit);
          for (const signal of FATAL_SIGNALS) {
            process.off(signal, handleSignal);
          }
        }
      }
    }

    await runLifecycleStep('trace wait for exit', () =>
      traceController.waitForExit(),
    );
    return;
  }

  // ===================================================================
  // Watch mode: one core-owned loop. Both executors signal invalidations, and
  // every signal is one queued cycle + finalize — a node rebuild landing during
  // a browser rerun waits instead of interleaving on the shared `stateManager`.
  // ===================================================================
  const enableCliShortcuts = deps.isCliShortcutsEnabled();
  // Constructed (not launched) below so its invalidation subscriber, the shared
  // teardown, and the stdin owner — all three closing over it — are in place
  // before either side's first cycle. Loading it validates its config and can
  // exit on a version mismatch, which is why that runs ahead of the node
  // env-dependency validation `ensureRunResources()` does further down; the
  // ordering that matters is the launch, and the launch is the first browser
  // cycle, deferred until those node resources are up.
  let browserExecutor: BrowserTestExecutor | undefined;
  const watchDriver = createWatchCycleDriver({
    context,
    coverageProvider,
    traceController,
    getTraceRun: () => activeTraceRun,
    setTraceRun: (traceRun) => {
      activeTraceRun = traceRun;
    },
    enableCliShortcuts,
    // The node side always keeps the session open; a browser-only mixed watch
    // has nothing left when the host's launch opened no session.
    isSessionLive: () =>
      hasNodeTestsToRun || (browserExecutor?.hasWatchSession() ?? false),
  });

  if (hasBrowserTestsToRun) {
    const browserProjectsToRun = planner.getBrowserProjectsToRun();
    browserExecutor = await deps.loadBrowserExecutor(
      context,
      browserProjectsToRun,
      coverageProvider,
      planner.getExecutorRunOptions(browserProjectsToRun),
    );
    await browserExecutor.init();
    const executor = browserExecutor;
    // The host resolves the rerun scope before signalling (its file-set diff is
    // consumed once), so the hint's filters are the scope this trigger asked
    // for — the cycle's own is that, plus whatever any signal folded into it.
    executor.onInvalidate(({ fileFilters }) =>
      watchDriver.runCycle(executor, {
        mode: 'on-demand',
        fileFilters,
        fromInvalidation: true,
      }),
    );
  }

  const browserTarget = browserExecutor;
  const watchTargets: WatchSessionTargets = {
    node: hasNodeTestsToRun
      ? {
          runCycle: (options) => watchDriver.runCycle(nodeExecutor, options),
          globTestEntries: () => nodeExecutor.globTestEntries(),
        }
      : undefined,
    browser: browserTarget && {
      rerun: (testPaths) => browserTarget.requestRerun(testPaths),
    },
  };

  // One teardown for the `q` shortcut, the fatal-signal handler, and the
  // config-change restart hook. The browser side closes first: its runtime owns
  // the servers the node executor's shutdown does not know about.
  const closeWatchSession = createWatchTeardown({
    executors: [...(browserExecutor ? [browserExecutor] : []), nodeExecutor],
    traceController,
    getTraceRun: () => activeTraceRun,
  });
  registerWatchSignalExit(context, closeWatchSession);

  const { onBeforeRestart } = await import('./restart');
  onBeforeRestart(closeWatchSession);

  // Installed before the first cycle so the ready banner can never appear
  // before stdin has an owner (a keystroke answering it would be swallowed).
  if (enableCliShortcuts) {
    // Exactly the executors the shortcuts fan out to: a key is answerable only
    // once every one of them has finalized a cycle, and in a mixed run the node
    // side gets there first while the browser host still has no watch session.
    const shortcutExecutors = [
      ...(watchTargets.node ? [nodeExecutor] : []),
      ...(browserExecutor ? [browserExecutor] : []),
    ];
    const closeCliShortcuts = await deps.setupCliShortcuts(
      createWatchShortcutHandlers(
        context,
        watchTargets,
        closeWatchSession,
        () => watchDriver.hasFinalizedCycle(shortcutExecutors),
      ),
    );
    onBeforeRestart(closeCliShortcuts);
  }

  if (hasNodeTestsToRun) {
    // The node executor's rebuilds are the watch trigger; its initial compile
    // signals too, which is what drives the first node cycle.
    nodeExecutor.onInvalidate(({ isFirstBuild }) =>
      watchDriver.runCycle(nodeExecutor, {
        mode: isFirstBuild ? 'all' : 'on-demand',
        fromInvalidation: true,
      }),
    );
    // Start the node dev server now that the subscriber is in place. `runCycle`
    // (invoked from that callback) reuses these resources via the in-flight
    // guard rather than starting a second server.
    await nodeExecutor.ensureRunResources();
  }

  if (browserExecutor) {
    // Deferred to here so node env-dependency validation failures never leave a
    // browser host running — the same ordering the pre-seam code had.
    const initialBrowserCycle = watchDriver.runCycle(browserExecutor, {
      mode: 'all',
    });
    if (hasNodeTestsToRun) {
      // The node side already keeps the process alive, so the browser session
      // boots in the background; a failed boot must still be reported.
      initialBrowserCycle.catch((error) => {
        logger.error(color.red('Browser Mode watch session failed:'), error);
        process.exitCode = 1;
      });
    } else {
      await initialBrowserCycle;
    }
  }
}
