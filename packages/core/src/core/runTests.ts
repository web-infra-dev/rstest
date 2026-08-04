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
  validateBrowserRunConfig,
} from './browser/loader';
import {
  FATAL_SIGNALS,
  getSignalExitCode,
  hasReportedFatalExit,
} from '../utils/signals';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import {
  type BrowserGlobalSetupStageResult,
  globalSetupFailureOutcome,
  runBrowserGlobalSetupStage,
} from './browser/globalSetupStage';
import { createNodeExecutor } from './executors/nodeExecutor';
import { runGlobalTeardown } from './globalSetup';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import { createRunPlanner } from './planner';
import type { Rstest } from './rstest';
import {
  createWatchCycleDriver,
  createWatchShortcutHandlers,
  createWatchTeardown,
  registerWatchSignalExit,
  type WatchSessionTargets,
} from './watchSession';

export async function runTests(context: Rstest): Promise<void> {
  // High-level flow (post-executor-seam):
  // 1. Split browser/node projects (the single `isBrowserProject` predicate).
  // 2. Resolve the plan first (each side's `modifyRstestConfig` hooks fire and
  //    the plan is read inside the planner — the init barrier), then construct
  //    whichever executors it says this run needs. 0 and N node projects take
  //    the same route: a zero-node run gets no node build from the planner and
  //    therefore no node executor (the cold-start gate, see below).
  // 3. Non-watch: `Promise.all(executors.map(e => e.runCycle()))` → one
  //    `finalizeRunCycle` → one `executors.close()` exit path.
  // 4. Watch: both executors signal through `onInvalidate` and every signal is
  //    one queued cycle + finalize, so node rebuilds, browser rebuilds, and CLI
  //    shortcuts all run through the same loop.
  cleanCoverageReports(context.normalizedConfig.coverage);

  if (context.relatedRerunReason === 'forceRerunTrigger') {
    logger.log(`${color.yellow(getForceRerunTriggerMessage(context))}\n`);
  }

  const browserProjects = context.projects.filter(isBrowserProject);
  const nodeProjects = context.projects.filter(isNodeProject);

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

  const traceController = createTraceController({
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
  // Init barrier: the planner resolves first — the node `modifyRstestConfig`
  // hooks fire, the browser's do too where the plan may depend on them (inside a
  // files-only discovery boot, hence the trace sink), and the plan is read while
  // it is being built — and only then is any executor constructed from it. One
  // planner answers for both sides, so there is no half-resolved pair to keep in
  // step, and every run shape — node-only, browser-only, mixed — comes through
  // here.
  // ===================================================================
  const planner = await createRunPlanner(context, {
    browserProjects,
    nodeProjects,
    isWatchMode,
    onTraceEvents: forwardBrowserTraceEvents,
  });

  const hasNodeTestsToRun = planner.hasNodeTestsToRun();
  const hasBrowserTestsToRun = planner.hasBrowserTestsToRun();

  // Gated on there being something to run: auto-installing a missing coverage
  // package for a run with no work is the wrong default.
  if (hasNodeTestsToRun || hasBrowserTestsToRun) {
    await ensureRunDependencies({ projects: [], rootPath, coverage });
    const coveragePluginLoadError = planner.coveragePluginLoadError();
    if (coveragePluginLoadError) {
      throw coveragePluginLoadError;
    }
  }

  // The single run-scoped provider, built before the executors so both sides can
  // take it through their constructor. A coverage-plugin load error is only
  // thrown when something actually runs (above); on the empty path it just means
  // no provider can be built.
  // Built for every shape, the empty ones included: an empty `--related`
  // resolution writes an empty coverage report rather than none at all.
  // "Coverage was requested and this run covered nothing" is a report, and
  // suppressing it for one run shape would re-split the single assembly.
  const coverageProvider = planner.coveragePluginLoadError()
    ? null
    : await createCoverageProviderWithLog(coverage, rootPath);

  // The cold-start gate, followed rather than re-decided here: the planner
  // brings up no node build for a run with zero node projects, so that run
  // constructs no node executor and pays for no node Rsbuild instance.
  // Constructing a `NodeExecutor` is not the cost being avoided — it allocates
  // closures and nothing else — so re-adding a branch above `createRunPlanner`
  // to "save" it is the regression the gate exists to prevent.
  const { nodeBuild } = planner;
  const nodeExecutor = nodeBuild
    ? createNodeExecutor(context, {
        ...nodeBuild,
        getPlan: planner.getPlan,
        coverageProvider,
        isWatchMode,
        getTraceRun: () => activeTraceRun,
      })
    : undefined;
  await nodeExecutor?.init();

  // Nothing to run on either side: route the empty run through the shared
  // finalize like every other non-watch path. This is also where an empty
  // `--related` resolution lands — the plan globs nothing for it, so no executor
  // is ever launched and the no-test-files verdict comes from the one finalize.
  if (!hasNodeTestsToRun && !hasBrowserTestsToRun) {
    // Loading the browser module is what validates the browser config, and this
    // branch may reach the end without loading it — a run whose browser config
    // is invalid would then finalize with "no test files found" instead of the
    // config error, since the plan cannot be trusted to be about a valid run in
    // the first place. So ask for the check directly, unless the planner already
    // got it: the discovery boot loads the module too, and validating twice
    // reprints every unsupported-option warning.
    //
    // This reaches empty *mixed* runs, not only browser-only ones: an empty
    // mixed run whose `@rstest/browser` is missing or version-mismatched
    // reports that and exits instead of finalizing with "no test files found"
    // and hiding it. Deliberate — a broken install is the more useful verdict,
    // and the loader's exit no longer drags the unexpected-exit banner with it.
    if (browserProjects.length && !planner.hasValidatedBrowserConfig()) {
      await validateBrowserRunConfig(context, browserProjects);
    }
    // An empty run is still a run as far as reporters are concerned. Every
    // other shape pairs a start with its end — the non-watch run below, every
    // watch cycle — and this branch was the one that finalized without ever
    // starting, which a reporter that opens state on `onTestRunStart` cannot
    // tell apart from a run that never happened.
    await notifyReportersOnTestRunStart(context);
    await finalizeRunCycle(context, {
      outcomes: [],
      mode: 'all',
      isWatchMode,
      coverageProvider,
      reportOnFailure: coverage.reportOnFailure,
      traceRun: activeTraceRun,
    });
    if (nodeExecutor) {
      await runLifecycleStep('executor cleanup', () => nodeExecutor.close());
    }
    await runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(activeTraceRun),
    );
    return;
  }

  // `hasNodeTestsToRun` implies the planner brought up a node build, so this is
  // the single handle every node-side gate below reads — carrying the narrowing
  // with it instead of re-deriving it from the boolean.
  const nodeExecutorToRun = hasNodeTestsToRun ? nodeExecutor : undefined;

  // ===================================================================
  // Non-watch: one executor loop, one finalize, one close exit path.
  // ===================================================================
  if (!isWatchMode) {
    // Start the node resources (dev server, env-dependency validation, pool)
    // BEFORE constructing the browser executor, so an early node dependency
    // failure (e.g. missing `jsdom`) never leaves a browser host mid-launch —
    // the same deliberate ordering the pre-seam code had. The build/stats phase
    // inside `runCycle` still overlaps with the browser run below.
    if (nodeExecutorToRun) {
      await nodeExecutorToRun.ensureRunResources();
    }

    const executors: TestExecutor[] = nodeExecutorToRun
      ? [nodeExecutorToRun]
      : [];

    // Single-exit-path rule: every executor closes through here exactly once
    // (idempotent), so no early return or throw can reintroduce a #1363-class
    // deferred-teardown hang. `executors` is read at close time, so the browser
    // executor pushed inside the try below is covered — including when its own
    // load/init fails with the node resources above already up.
    //
    // Three things about this net are deliberate on every run shape, zero-node
    // included, and none is free to drift: executors close first and
    // `runGlobalTeardown()` drains in the `finally`, so a user `globalSetup`
    // teardown callback runs after the browser host and its dev servers are
    // gone; the signal path uses that same order; and the exit handler is
    // registered unconditionally, so a mid-run unexpected exit prints and sets
    // a failing code rather than ending quietly. A teardown callback that needs
    // a live server is the one reason to revisit the first of those.
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
      // A reported fatal exit is the one thing this net must stay out of. The
      // browser loader exits this way on a missing or version-mismatched
      // `@rstest/browser`, after printing the install command — and it exits
      // from inside the `try` below, so the `finally` that would remove this
      // handler never runs. Without the check the user gets an actionable error
      // followed by a red "exited unexpectedly", plus a global teardown fired
      // out of an exit handler.
      //
      // Unpinned, though not for want of a `process.exit` spy (`utils/signals`
      // is pinned with one). What blocks a pin here is that this is a closure
      // reachable only by emitting a real `'exit'` event — which would fire
      // every other listener the worker has — and that `reportedFatalExit` is a
      // sticky module-level flag with no reset, so setting it would leak into
      // every later test in the file.
      if (hasReportedFatalExit()) {
        return;
      }
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
        browserExecutor = await loadBrowserExecutor(
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
        browserStage = await runBrowserGlobalSetupStage(
          context,
          browserProjectsToRun,
          { entriesCache: planner.getPlan().entriesCache },
        );
      }

      // After the browser globalSetup stage, not before it: a setup that fails
      // takes the run down before any reporter was told one started, which is
      // the pairing every other shape already has.
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
  const enableCliShortcuts = isCliShortcutsEnabled();
  // Constructed (not launched) below so its invalidation subscriber, the shared
  // teardown, and the stdin owner — all three closing over it — are in place
  // before either side's first cycle. Loading it validates its config and can
  // exit on a version mismatch, which is why that runs ahead of the node
  // env-dependency validation `ensureRunResources()` does further down; the
  // ordering that matters is the launch, and the launch is the first browser
  // cycle, deferred until those node resources are up.
  let browserExecutor: BrowserTestExecutor | undefined;
  // Assigned once the teardown below exists; until then nothing can be closing.
  let isSessionClosing = () => false;
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
      Boolean(nodeExecutorToRun) ||
      (browserExecutor?.hasWatchSession() ?? false),
    isSessionClosing: () => isSessionClosing(),
  });

  if (hasBrowserTestsToRun) {
    const browserProjectsToRun = planner.getBrowserProjectsToRun();
    browserExecutor = await loadBrowserExecutor(
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
        trigger: 'invalidation',
      }),
    );
  }

  const browserTarget = browserExecutor;
  const watchTargets: WatchSessionTargets = {
    node: nodeExecutorToRun
      ? {
          runCycle: (options) =>
            watchDriver.runCycle(nodeExecutorToRun, options),
          globTestEntries: () => planner.globTestEntries(),
        }
      : undefined,
    browser: browserTarget && {
      rerun: (testPaths) => browserTarget.requestRerun(testPaths),
    },
  };

  // One teardown for the `q` shortcut, the fatal-signal handler, and the
  // config-change restart hook. The browser side closes first: its runtime owns
  // the servers the node executor's shutdown does not know about.
  const watchTeardown = createWatchTeardown({
    executors: [
      ...(browserExecutor ? [browserExecutor] : []),
      ...(nodeExecutor ? [nodeExecutor] : []),
    ],
    traceController,
    getTraceRun: () => activeTraceRun,
  });
  const closeWatchSession = () => watchTeardown.close();
  isSessionClosing = () => watchTeardown.isClosing();
  registerWatchSignalExit(context, closeWatchSession);

  const { onBeforeRestart } = await import('./restart');
  onBeforeRestart(closeWatchSession);

  // Installed before the first cycle so the ready banner can never appear
  // before stdin has an owner (a keystroke answering it would be swallowed).
  if (enableCliShortcuts) {
    // Every executor this run has, not just the ones a given key queues a cycle
    // for: `p` is node-only, but the `context.fileFilters` it writes are state
    // the browser side re-reads on its next cycle. A key is answerable only once
    // every one of them is past its first cycle, and in a mixed run the node
    // side gets there first while the browser host still has no watch session.
    const shortcutExecutors = [
      ...(nodeExecutorToRun ? [nodeExecutorToRun] : []),
      ...(browserExecutor ? [browserExecutor] : []),
    ];
    const closeCliShortcuts = await setupCliShortcuts(
      createWatchShortcutHandlers(
        context,
        watchTargets,
        closeWatchSession,
        () => watchDriver.hasSettledCycle(shortcutExecutors),
      ),
    );
    // Released by the teardown rather than the restart hook alone: it is the
    // process-level owner that keeps the loop alive, so a session that ends
    // without a restart (a setup failure) would otherwise never exit.
    watchTeardown.addCleanup(closeCliShortcuts);
  }

  // Carried only by the initial browser cycle: that cycle is the host launch,
  // and the host stores the change-set for the session, so a rerun's options
  // never need it (the executor drops them).
  let browserWatchEnv: Record<string, string | undefined> | undefined;
  if (browserExecutor) {
    // Ahead of the node dev server, for the reason the non-watch assembly runs
    // the stage before dispatching node work: it mutates the shared host
    // `process.env`, which the pool re-reads at dispatch, so a node cycle
    // started first would miss the browser setups' env changes. The node
    // dependency check comes first in turn, so a node project that cannot run
    // rejects the session before a user setup has mutated anything — which is
    // why `validateRunDependencies` is a seam member of its own rather than
    // something `ensureRunResources` alone owns.
    try {
      if (nodeExecutorToRun) {
        await watchTeardown.track(nodeExecutorToRun.validateRunDependencies());
      }
      if (watchTeardown.isClosing()) {
        return;
      }
      const stage = await watchTeardown.track(
        runBrowserGlobalSetupStage(context, planner.getBrowserProjectsToRun(), {
          entriesCache: planner.getPlan().entriesCache,
        }),
      );
      if (stage.errors.length) {
        // Reported through the same finalize every cycle uses, so a watch
        // session that dies in setup still leaves the reporters a run — and
        // then rethrown, because a watch session that never opened has to end
        // the process rather than sit on a stdin owner nothing can answer.
        await notifyReportersOnTestRunStart(context);
        await finalizeRunCycle(context, {
          outcomes: [globalSetupFailureOutcome(stage.errors)],
          mode: 'all',
          isWatchMode: true,
          coverageProvider,
          reportOnFailure: coverage.reportOnFailure,
          traceRun: activeTraceRun,
        });
        throw new AggregateError(stage.errors, 'Browser globalSetup failed');
      }
      if (watchTeardown.isClosing()) {
        await closeWatchSession();
        return;
      }
      browserWatchEnv = stage.env;
    } catch (error) {
      // A close already under way owns the exit; re-throwing its victim's
      // rejection would replace a clean shutdown with a crash.
      const wasClosing = watchTeardown.isClosing();
      await closeWatchSession();
      if (wasClosing) {
        return;
      }
      throw error;
    }
  }

  if (nodeExecutorToRun) {
    // The node executor's rebuilds are the watch trigger; its initial compile
    // signals too, which is what drives the first node cycle.
    nodeExecutorToRun.onInvalidate(({ isFirstBuild }) =>
      watchDriver.runCycle(nodeExecutorToRun, {
        mode: isFirstBuild ? 'all' : 'on-demand',
        trigger: 'invalidation',
      }),
    );
    // Start the node dev server now that the subscriber is in place. `runCycle`
    // (invoked from that callback) reuses these resources via the in-flight
    // guard rather than starting a second server.
    await nodeExecutorToRun.ensureRunResources();
  }

  if (browserExecutor) {
    // Deferred to here so node env-dependency validation failures never leave a
    // browser host running — the same ordering the pre-seam code had.
    const initialBrowserCycle = watchDriver.runCycle(browserExecutor, {
      mode: 'all',
      env: browserWatchEnv,
    });
    if (nodeExecutorToRun) {
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
