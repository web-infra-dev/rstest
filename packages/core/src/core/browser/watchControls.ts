import { createCoverageProvider } from '../../coverage';
import type {
  BrowserTestRunResult,
  BrowserWatchHandles,
  ProjectContext,
  ProjectEntries,
} from '../../types';
import { clearScreen, color, logger, type TraceSpan } from '../../utils';
import { FATAL_SIGNALS, getSignalExitCode } from '../../utils/signals';
import {
  globalSetupFailureOutcome,
  runBrowserGlobalSetupStage,
} from './globalSetupStage';
import {
  type BrowserHostModule,
  loadAndValidateBrowserModule,
  runBrowserModeTests,
} from './loader';
import type { BrowserRunPlanner } from './runPlanner';
import { isCliShortcutsEnabled, setupCliShortcuts } from '../cliShortcuts';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunStart,
  runLifecycleStep,
} from '../finalizeRun';
import { runGlobalTeardown } from '../globalSetup';
import type { Rstest } from '../rstest';
import {
  collectFailedTestPaths,
  collectUnmatchedSnapshotTestPaths,
} from '../watchState';

/**
 * Keep fatal-signal handling active for the full watch lifecycle, including
 * setup and cleanup phases where browser watch handles do not exist yet.
 * Embedded hosts own the process lifecycle, so nothing is registered there.
 */
export function registerWatchSignalExit(
  context: Rstest,
  close: () => Promise<void>,
): () => void {
  if (context.embedded) {
    return () => {};
  }
  const handleSignal = async (signal: NodeJS.Signals) => {
    logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
    await close();
    process.exit(getSignalExitCode(signal));
  };
  for (const signal of FATAL_SIGNALS) {
    process.on(signal, handleSignal);
  }
  return () => {
    for (const signal of FATAL_SIGNALS) {
      process.off(signal, handleSignal);
    }
  };
}

/**
 * Install the watch-mode stdin owner for a browser-only watch session. The
 * host never subscribes to stdin; core drives the host's rerun transport
 * through the session's {@link BrowserWatchHandles}. Filter shortcuts (t/p)
 * are not plumbed through the browser rerun pipeline yet, so they are omitted
 * and their keys show greyed hints.
 */
async function setupBrowserWatchShortcuts(
  context: Rstest,
  watch: BrowserWatchHandles,
): Promise<() => void> {
  if (!isCliShortcutsEnabled()) {
    return () => {};
  }
  const { snapshotManager } = context;
  return setupCliShortcuts({
    closeServer: watch.close,
    runAll: async () => {
      clearScreen();
      await watch.rerun();
    },
    runFailedTests: async () => {
      const failedTests = collectFailedTestPaths(context);

      if (!failedTests.length) {
        logger.log(
          color.yellow('\nNo failed tests were found that needed to be rerun.'),
        );
        return;
      }

      clearScreen();
      await watch.rerun(failedTests);
    },
    updateSnapshot: async () => {
      if (!snapshotManager.summary.unmatched) {
        logger.log(
          color.yellow('\nNo snapshots were found that needed to be updated.'),
        );
        return;
      }
      const unmatchedTests = collectUnmatchedSnapshotTestPaths(context);

      clearScreen();

      const originalUpdateSnapshot = snapshotManager.options.updateSnapshot;
      snapshotManager.options.updateSnapshot = 'all';
      try {
        await watch.rerun(unmatchedTests);
      } finally {
        snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
      }
    },
  });
}

/**
 * Own every asynchronous phase that a browser watch restart must settle before
 * the replacement session starts. Callers track setup/launch promises in
 * sequence and must not start another phase once `isClosing()` becomes true.
 */
export function createBrowserWatchLifecycle(
  getWatch: () => BrowserWatchHandles | undefined,
): {
  track<T>(pending: Promise<T>): Promise<T>;
  isClosing(): boolean;
  addControlCleanup(cleanup: () => void): void;
  close(): Promise<void>;
} {
  let pending: Promise<unknown> | undefined;
  let closePromise: Promise<void> | undefined;
  let closeRequested = false;
  const controlCleanups: Array<() => void> = [];

  const close = () => {
    closeRequested = true;
    closePromise ??= (async () => {
      try {
        // A config restart can arrive while globalSetup or the browser host is
        // still launching. Settle that phase before reading its watch handles.
        await pending?.catch(() => undefined);
        const watch = getWatch();
        if (watch) {
          await runLifecycleStep('browser watch cleanup', () => watch.close());
        }
      } finally {
        try {
          await runLifecycleStep('global teardown', () => runGlobalTeardown());
        } finally {
          // Keep Ctrl+C active for the entire cleanup window. A signal arriving
          // here awaits this same close promise and exits after cleanup.
          for (const cleanup of controlCleanups.splice(0)) {
            cleanup();
          }
        }
      }
    })();
    return closePromise;
  };

  return {
    track<T>(nextPending: Promise<T>): Promise<T> {
      pending = nextPending;
      return nextPending;
    },
    isClosing: () => closeRequested,
    addControlCleanup(cleanup) {
      if (closeRequested) {
        cleanup();
      } else {
        controlCleanups.push(cleanup);
      }
    },
    close,
  };
}

/**
 * Route every browser globalSetup failure through reporters before the watch
 * command exits. The thrown AggregateError at the call site then preserves the
 * same complete error set for non-reporter consumers.
 */
async function reportBrowserWatchGlobalSetupFailure(
  context: Rstest,
  errors: Error[],
): Promise<void> {
  await notifyReportersOnTestRunStart(context);
  await finalizeRunCycle(context, {
    outcomes: [globalSetupFailureOutcome(errors)],
    mode: 'all',
    isWatchMode: true,
    coverageProvider: null,
    reportOnFailure: false,
  });
}

export async function runBrowserWatchGlobalSetup(
  context: Rstest,
  browserProjects: ProjectContext[],
  entriesCache?: Map<string, ProjectEntries>,
): Promise<Record<string, string | undefined> | undefined> {
  const stage = await runBrowserGlobalSetupStage(context, browserProjects, {
    entriesCache,
  });
  if (stage.errors.length) {
    await reportBrowserWatchGlobalSetupFailure(context, stage.errors);
    throw new AggregateError(stage.errors, 'Browser globalSetup failed');
  }
  return stage.env;
}

/**
 * Report the initial watch cycle's browser coverage — the single owner for both
 * the browser-only and the mixed watch path, which would otherwise each hand the
 * host's folded map somewhere different. Only the first cycle lands here: the
 * host folds it onto the run result and strips it off the file results, so
 * nothing downstream can recover it, while every rerun reports through the
 * host's per-rerun finalize.
 */
export async function reportInitialCycleCoverage(
  context: Rstest,
  result: BrowserTestRunResult | void,
  traceSpan?: TraceSpan,
): Promise<void> {
  if (
    !result?.coverage ||
    !result.results.length ||
    result.unhandledErrors?.length
  ) {
    return;
  }
  const { coverage } = context.normalizedConfig;
  // Same gate `finalizeRunCycle` applies to every rerun, so a failing first
  // cycle does not write a report the configured policy withholds from the
  // cycles after it.
  if (result.hasFailure && !coverage.reportOnFailure) {
    return;
  }
  const coverageProvider = await createCoverageProvider(
    coverage,
    context.rootPath,
  );
  if (!coverageProvider) {
    return;
  }
  const { generateCoverage } = await import('../../coverage/generate');
  await generateCoverage(context, result.coverage, coverageProvider, traceSpan);
}

/**
 * Attach the core-owned stdin shortcuts to a browser-only watch session. The
 * returned cleanup is owned by the session lifecycle so config restart removes
 * the stdin owner only after the browser and global teardown have settled.
 */
export async function attachBrowserWatchShortcuts(
  context: Rstest,
  watch: BrowserWatchHandles | undefined,
): Promise<() => void> {
  if (!watch) {
    return () => {};
  }
  return setupBrowserWatchShortcuts(context, watch);
}

/**
 * Own the browser side of a mixed watch run: load-boundary validation,
 * globalSetup, environment forwarding, host launch, and browser teardown.
 * The generic orchestrator only coordinates this lifecycle with node and trace
 * cleanup.
 */
export interface BrowserWatchOrchestrator {
  /**
   * Validate Browser Mode and run globalSetup before either watch driver starts.
   * Returns false when cleanup won the race with an in-flight phase.
   */
  prepare(): Promise<boolean>;
  /**
   * Launch the session without awaiting it (it spans the whole watch session);
   * a failed browser boot is surfaced as an error + exit code 1 instead of
   * being silently dropped. No-op when no browser tests are runnable.
   */
  startBackground(): void;
  /**
   * Zero-node mixed watch: only the browser side runs. Await the initial run
   * and attach the core-owned stdin shortcuts.
   */
  runForeground(): Promise<void>;
  /** Fan a node-owned CLI shortcut (a/f/u) out to the browser session. */
  rerun(testPaths?: string[]): Promise<void>;
  close(): Promise<void>;
}

export function createBrowserWatchOrchestrator({
  context,
  planner,
  entriesCache,
}: {
  context: Rstest;
  planner: BrowserRunPlanner;
  entriesCache: Map<string, ProjectEntries>;
}): BrowserWatchOrchestrator {
  let handles: BrowserWatchHandles | undefined;
  let browserModule: BrowserHostModule | undefined;
  let env: Record<string, string | undefined> | undefined;
  const lifecycle = createBrowserWatchLifecycle(() => handles);

  const start = () => {
    const projects = planner.getBrowserProjectsToRun();
    return runBrowserModeTests(
      context,
      projects,
      {
        ...planner.getWatchRunOptions(projects),
        env,
      },
      browserModule,
    );
  };

  // The initial cycle's coverage arrives on the result and is stripped off the
  // file results, so both entry paths must land it here before dropping it.
  const landInitialCycle = async (
    result: BrowserTestRunResult | void,
  ): Promise<void> => {
    handles = result?.watch;
    await reportInitialCycleCoverage(context, result);
  };

  return {
    async prepare() {
      if (!planner.hasBrowserTestsToRun() || lifecycle.isClosing()) {
        return !lifecycle.isClosing();
      }
      const projects = planner.getBrowserProjectsToRun();
      browserModule = await lifecycle.track(
        loadAndValidateBrowserModule(context, projects),
      );
      if (lifecycle.isClosing()) {
        return false;
      }
      env = await lifecycle.track(
        runBrowserWatchGlobalSetup(context, projects, entriesCache),
      );
      return !lifecycle.isClosing();
    },
    startBackground() {
      if (!planner.hasBrowserTestsToRun() || lifecycle.isClosing()) {
        return;
      }
      // One catch after the handler, not `then(onFulfilled, onRejected)`: the
      // rejection handler of a two-arg `then` cannot see the handler's own
      // failure, so a throwing initial-cycle landing would escape unhandled.
      lifecycle.track(start().then(landInitialCycle)).catch((error) => {
        if (!lifecycle.isClosing()) {
          logger.error(color.red('Browser Mode watch session failed:'), error);
          process.exitCode = 1;
        }
      });
    },
    async runForeground() {
      try {
        const result = await lifecycle.track(
          start().then(async (initialResult) => {
            await landInitialCycle(initialResult);
            return initialResult;
          }),
        );
        if (lifecycle.isClosing()) {
          await lifecycle.close();
        } else if (result?.watch) {
          await lifecycle.track(
            attachBrowserWatchShortcuts(context, {
              ...result.watch,
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
          throw error;
        }
      }
    },
    async rerun(testPaths) {
      await handles?.rerun(testPaths);
    },
    close: lifecycle.close,
  };
}
