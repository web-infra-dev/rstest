import { BlobReporter } from '../reporter/blob';
import { exitReporters } from '../reporter';
import {
  cleanCoverageReports,
  createCoverageProviderWithLog,
  ensureCoverageProviderInstalled,
} from '../coverage';
import type { TestExecutor } from '../types';
import {
  color,
  createTraceController,
  getForceRerunTriggerMessage,
  logger,
  toError,
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
import { registerFatalSignalExit } from './signalExit';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import {
  type BrowserGlobalSetupStageResult,
  runBrowserGlobalSetupStage,
} from './browser/globalSetupStage';
import { createNodeExecutor } from './executors/nodeExecutor';
import { cycleFailureOutcome, runGlobalTeardown } from './globalSetup';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import { createTestPlanner } from './planner';
import type { Rstest } from './rstest';
import {
  createWatchCycleDriver,
  createWatchShortcutHandlers,
  createWatchTeardown,
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
  // 3. Non-watch: settle all executor cycles → one
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
    } else if (context.fileFilters !== undefined) {
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
  const planner = await createTestPlanner(context, {
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
    await ensureCoverageProviderInstalled(coverage, rootPath, {
      confirm: context.packageInstallerConfirm,
    });
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
    : await createCoverageProviderWithLog(
        context.normalizedConfig.coverage,
        rootPath,
      );

  // The cold-start gate, followed rather than re-decided here: the planner
  // brings up no node build for a run with zero node projects, so that run
  // constructs no node executor and pays for no node Rsbuild instance.
  // Constructing a `NodeExecutor` is not the cost being avoided — it allocates
  // closures and nothing else — so re-adding a branch above `createTestPlanner`
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

  const isEmptyRun = !hasNodeTestsToRun && !hasBrowserTestsToRun;

  // `hasNodeTestsToRun` implies the planner brought up a node build, so this is
  // the single handle every node-side gate below reads — carrying the narrowing
  // with it instead of re-deriving it from the boolean.
  const nodeExecutorToRun = hasNodeTestsToRun ? nodeExecutor : undefined;

  // ===================================================================
  // Non-watch: one executor loop, one finalize, one close exit path.
  // ===================================================================
  if (!isWatchMode || isEmptyRun) {
    // Start the node resources (dev server, env-dependency validation, pool)
    // BEFORE constructing the browser executor, so an early node dependency
    // failure (e.g. missing `jsdom`) never leaves a browser host mid-launch —
    // the same deliberate ordering the pre-seam code had. The build/stats phase
    // inside `runCycle` still overlaps with the browser run below.
    if (nodeExecutorToRun) {
      await nodeExecutorToRun.ensureRunResources();
    }

    const executors: TestExecutor[] = nodeExecutor ? [nodeExecutor] : [];
    const executorsToRun: TestExecutor[] = nodeExecutorToRun
      ? [nodeExecutorToRun]
      : [];

    // A signal can close existing executors while another is still loading.
    // Memoize per executor so the final drain also closes late arrivals once.
    const executorClosePromises = new Map<TestExecutor, Promise<void>>();
    const closeExecutors = async () => {
      const closePromises = executors.map((executor) => {
        let promise = executorClosePromises.get(executor);
        if (!promise) {
          promise = runLifecycleStep('executor cleanup', () =>
            executor.close(),
          );
          executorClosePromises.set(executor, promise);
        }
        return promise;
      });
      await Promise.allSettled(closePromises);
      await Promise.all(closePromises);
    };

    let isInterrupted = false;
    let resolveRunFinished!: () => void;
    const runFinished = new Promise<void>((resolve) => {
      resolveRunFinished = resolve;
    });
    let isTeardown = false;
    let releasePromise: Promise<void> | undefined;
    const releaseRun = () =>
      (releasePromise ??= (async () => {
        try {
          try {
            await closeExecutors();
          } finally {
            // Closing unblocks the cycle; its finalizer must finish before exit.
            await runFinished;
          }
          if (!isTeardown) {
            await runLifecycleStep('trace run finalize', () =>
              activeTraceRun.finalize(),
            );
          }
          if (!isInterrupted) {
            // On interrupt the registrar owns exit; trace must not wait for
            // another signal after the one that already started shutdown.
            disposeSignals();
            await runLifecycleStep('trace wait for exit', () =>
              traceController.waitForExit(),
            );
          }
          await runLifecycleStep('trace controller cleanup', () =>
            traceController.close(),
          );
        } finally {
          process.off('exit', unExpectedExit);
          // API result capture must settle before onExit releases its listeners.
          context.exitCode.finishCycle();
          await exitReporters(context);
        }
      })());

    const unExpectedExit = (code?: number) => {
      if (isInterrupted) {
        process.exitCode = context.exitCode.current;
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
        runGlobalTeardown(context).catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        });
        context.exitCode.raise(1);
      }
    };

    const disposeSignals = registerFatalSignalExit(context, {
      interrupt: async () => {
        isInterrupted = true;
        for (const reporter of context.reporters) {
          if (reporter instanceof BlobReporter) {
            try {
              reporter.cancel();
            } catch (error) {
              // Invalidation must not prevent executor and global teardown.
              logger.warn(`Failed to remove cancelled blob report: ${error}`);
            }
          }
        }
        await Promise.all(executors.map((executor) => executor.interrupt?.()));
      },
      release: releaseRun,
    });

    if (!context.embedded) {
      process.on('exit', unExpectedExit);
    }

    try {
      // Empty mixed runs still validate the browser install; node-only filters
      // with work must not load a browser executor they will never use.
      // This is per-command policy, kept out of the planner; the exclusion is
      // pinned in e2e/filter/related.test.ts.
      if (
        isEmptyRun &&
        browserProjects.length &&
        !planner.hasValidatedBrowserConfig()
      ) {
        await validateBrowserRunConfig(context, browserProjects);
      }
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
        executorsToRun.push(browserExecutor);
        if (!isInterrupted) await browserExecutor.init();
        // Core-owned pre-cycle globalSetup stage over the resolved browser
        // subset. Its context-local env changes are visible to both the browser
        // cycle and node workers dispatched below.
        if (!isInterrupted) {
          browserStage = await runBrowserGlobalSetupStage(
            context,
            browserProjectsToRun,
            { entriesCache: planner.getPlan().entriesCache },
          );
        }
      }

      const reportersStarted = !isInterrupted;
      if (reportersStarted) await notifyReportersOnTestRunStart(context);
      // Settle every cycle before finalizing so a failed executor cannot
      // truncate its siblings or trigger global teardown early. Rejections
      // become failure outcomes so every started run reports its end.
      const cyclePromises = !isInterrupted
        ? executorsToRun.map((executor) =>
            executor === browserExecutor && browserStage.errors.length
              ? Promise.resolve(cycleFailureOutcome(browserStage.errors))
              : executor.runCycle({
                  buildId: 1,
                  mode: 'all',
                  updateSnapshot: snapshotManager.options.updateSnapshot,
                  env: browserStage.env,
                  onTraceEvents: forwardBrowserTraceEvents,
                }),
          )
        : [];
      const settledCycles = await Promise.allSettled(cyclePromises);
      const outcomes = settledCycles.flatMap((cycle) => {
        if (cycle.status === 'fulfilled') return [cycle.value];
        // An interrupted cycle's rejection is the interrupt, not a run failure.
        return isInterrupted
          ? []
          : [cycleFailureOutcome([toError(cycle.reason)])];
      });

      await finalizeRunCycle(context, {
        outcomes,
        mode: 'all',
        isWatchMode: false,
        isInterrupted: () => isInterrupted,
        reportersStarted,
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun: activeTraceRun,
      });
      isTeardown = true;
    } finally {
      try {
        try {
          await closeExecutors();
        } finally {
          // Setup can register teardown until the active run settles. The
          // signal path closes executors early but must not drain this queue.
          await runLifecycleStep('global teardown', () =>
            runGlobalTeardown(context),
          );
        }
      } finally {
        resolveRunFinished();
        await releaseRun();
      }
    }

    return;
  }

  // ===================================================================
  // Watch mode: one core-owned loop. Both executors signal invalidations, and
  // every signal is one queued cycle + finalize — a node rebuild landing during
  // a browser rerun waits instead of interleaving on the shared `stateManager`.
  // ===================================================================
  const enableCliShortcuts = isCliShortcutsEnabled(context);
  // Constructed (not launched) below so its invalidation subscriber, the shared
  // teardown, and the stdin owner — all three closing over it — are in place
  // before either side's first cycle. Loading it can fail on a version mismatch,
  // which is why that runs ahead of the node env-dependency validation
  // `ensureRunResources()` does further down; the ordering that matters is the
  // launch, and the launch is the first browser cycle, deferred until those node
  // resources are up.
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

  let nodeFileFilterPatterns = context.fileFilters;
  let nodeFileFilters =
    nodeFileFilterPatterns !== undefined
      ? await planner.globTestEntries(nodeFileFilterPatterns)
      : undefined;
  const browserTarget = browserExecutor;
  const watchTargets: WatchSessionTargets = {
    node: nodeExecutorToRun
      ? {
          runCycle: (options) =>
            watchDriver.runCycle(nodeExecutorToRun, {
              ...options,
              fileFilters: options?.fileFilters ?? nodeFileFilters,
            }),
          globTestEntries: (filters) => planner.globTestEntries(filters),
          setFileFilters: (fileFilters) => {
            nodeFileFilterPatterns = undefined;
            nodeFileFilters = fileFilters;
          },
        }
      : undefined,
    browser: browserTarget && {
      rerun: (testPaths) => browserTarget.requestRerun(testPaths),
    },
  };

  // One teardown for the `q` shortcut, the fatal-signal handler, and the
  // config-change restart hook. The browser side closes first: its runtime owns
  // the servers the node executor's shutdown does not know about.
  const executors: TestExecutor[] = [
    ...(browserExecutor ? [browserExecutor] : []),
    ...(nodeExecutor ? [nodeExecutor] : []),
  ];
  const watchTeardown = createWatchTeardown({
    context,
    executors,
    traceController,
    getTraceRun: () => activeTraceRun,
  });
  const closeWatchSession = () => watchTeardown.close();
  context.closeWatchSession = closeWatchSession;
  watchTeardown.addCleanup(() => {
    context.closeWatchSession = undefined;
  });
  const closeActiveWatchSession = () =>
    context.closeWatchSession?.() ?? closeWatchSession();
  isSessionClosing = () => watchTeardown.isClosing();
  watchTeardown.addCleanup(
    registerFatalSignalExit(context, {
      interrupt: async () => {
        await Promise.all(executors.map((executor) => executor.interrupt?.()));
      },
      release: closeActiveWatchSession,
    }),
  );

  // Installed before the first cycle so the ready banner can never appear
  // before stdin has an owner (a keystroke answering it would be swallowed).
  if (enableCliShortcuts) {
    // Every executor this run has, not just the ones a given key queues a cycle
    // for. A key is answerable only once every one of them is past its first
    // cycle, and in a mixed run the node side gets there first while the browser
    // host still has no watch session.
    const shortcutExecutors = [
      ...(nodeExecutorToRun ? [nodeExecutorToRun] : []),
      ...(browserExecutor ? [browserExecutor] : []),
    ];
    const closeCliShortcuts = await setupCliShortcuts(
      createWatchShortcutHandlers(
        context,
        watchTargets,
        closeActiveWatchSession,
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
  try {
    if (browserExecutor) {
      // Ahead of the node dev server, for the reason the non-watch assembly runs
      // the stage before dispatching node work: the pool composes its env from
      // the context-local overlay at dispatch, so a node cycle started first
      // would miss the browser setups' env changes. The node
      // dependency check comes first in turn, so a node project that cannot run
      // rejects the session before a user setup has run — which is
      // why `validateRunDependencies` is a seam member of its own rather than
      // something `ensureRunResources` alone owns.
      if (nodeExecutorToRun) {
        await watchTeardown.track(nodeExecutorToRun.validateRunDependencies());
      }
      if (watchTeardown.isClosing()) {
        return;
      }
      const stage = await watchTeardown.track(
        runBrowserGlobalSetupStage(context, planner.getBrowserProjectsToRun(), {
          entriesCache: planner.getPlan().entriesCache,
          watch: true,
        }),
      );
      if (stage.errors.length) {
        await watchDriver.runCycle(browserExecutor, {
          outcome: cycleFailureOutcome(stage.errors),
        });
      }
      if (watchTeardown.isClosing()) {
        await closeWatchSession();
        return;
      }
      browserWatchEnv = stage.env;
    }

    if (nodeExecutorToRun) {
      nodeExecutorToRun.onInvalidate(async ({ isFirstBuild }) => {
        if (nodeFileFilterPatterns !== undefined) {
          nodeFileFilters = await planner.globTestEntries(
            nodeFileFilterPatterns,
          );
        }
        await watchDriver.runCycle(nodeExecutorToRun, {
          mode: isFirstBuild ? 'all' : 'on-demand',
          fileFilters: nodeFileFilters,
          trigger: 'invalidation',
        });
      });
      // Start node resources after subscribing, then await the first cycle
      // dispatched by the compiler callback.
      await nodeExecutorToRun.ensureRunResources();
      await watchDriver.firstCycle(nodeExecutorToRun);
      if (watchTeardown.isClosing()) {
        await closeWatchSession();
        return;
      }
    }

    if (browserExecutor) {
      // Launch only after node startup succeeds, so a rejected node session
      // cannot leave a browser host running.
      await watchDriver.runCycle(browserExecutor, {
        mode: 'all',
        env: browserWatchEnv,
      });
    }
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
