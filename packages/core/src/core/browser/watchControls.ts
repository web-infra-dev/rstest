import { createCoverageProvider } from '../../coverage';
import type { BrowserTestRunResult, BrowserWatchHandles } from '../../types';
import { clearScreen, color, logger, type TraceSpan } from '../../utils';
import { FATAL_SIGNALS, getSignalExitCode } from '../../utils/signals';
import { runBrowserModeTests } from './loader';
import type { BrowserRunPlanner } from './runPlanner';
import { isCliShortcutsEnabled, setupCliShortcuts } from '../cliShortcuts';
import { runLifecycleStep } from '../finalizeRun';
import { runGlobalTeardown } from '../globalSetup';
import type { Rstest } from '../rstest';
import {
  collectFailedTestPaths,
  collectUnmatchedSnapshotTestPaths,
} from '../watchState';

/**
 * Own the fatal-signal → exit path for a browser-only watch session (node
 * watch parity): tear the session down through the watch handles (idempotent
 * with the host's own cleanup net) and exit with the POSIX 128+signal code.
 * Embedded hosts own the process lifecycle, so nothing is registered there.
 */
function registerBrowserWatchSignalExit(
  context: Rstest,
  watch: BrowserWatchHandles,
): () => void {
  if (context.embedded) {
    return () => {};
  }
  const handleSignal = async (signal: NodeJS.Signals) => {
    logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
    await watch.close();
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
): Promise<void> {
  if (!isCliShortcutsEnabled()) {
    return;
  }
  const { snapshotManager } = context;
  const closeCliShortcuts = await setupCliShortcuts({
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
  const { onBeforeRestart } = await import('../restart');
  onBeforeRestart(closeCliShortcuts);
}

export function createBrowserWatchClose(
  getWatch: () => BrowserWatchHandles | undefined,
): () => Promise<void> {
  let closePromise: Promise<void> | undefined;

  return () => {
    closePromise ??= (async () => {
      try {
        const watch = getWatch();
        if (watch) {
          await runLifecycleStep('browser watch cleanup', () => watch.close());
        }
      } finally {
        await runLifecycleStep('global teardown', () => runGlobalTeardown());
      }
    })();
    return closePromise;
  };
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
 * Attach core-owned controls to a browser-only watch session: the fatal-signal
 * exit path first, then the single stdin shortcuts owner. A config restart
 * removes those process-level controls and closes the whole session so the next
 * config creates a fresh browser host. No-op when the run produced no watch
 * handles.
 */
export async function attachBrowserWatchControls(
  context: Rstest,
  watch: BrowserWatchHandles | undefined,
): Promise<void> {
  if (!watch) {
    return;
  }
  const removeSignalExit = registerBrowserWatchSignalExit(context, watch);
  await setupBrowserWatchShortcuts(context, watch);
  const { onBeforeRestart } = await import('../restart');
  onBeforeRestart(async () => {
    removeSignalExit();
    await watch.close();
  });
}

/**
 * The browser side of a mixed watch run, wrapped so the orchestrator never
 * tracks {@link BrowserWatchHandles} directly. The session is host-driven and
 * self-finalizing; `rerun` is a safe no-op until the initial run lands the
 * handles, while `close` always drains global teardown.
 */
export interface BrowserWatchSession {
  /**
   * Launch the session without awaiting it (it spans the whole watch session);
   * a failed browser boot is surfaced as an error + exit code 1 instead of
   * being silently dropped. No-op when no browser tests are runnable.
   */
  startBackground(): void;
  /**
   * Zero-node mixed watch: only the browser side runs. Await the initial run
   * and attach the core-owned watch controls (signal exit + stdin shortcuts).
   */
  runForeground(): Promise<void>;
  /** Fan a node-owned CLI shortcut (a/f/u) out to the browser session. */
  rerun(testPaths?: string[]): Promise<void>;
  close(): Promise<void>;
}

export function createBrowserWatchSession({
  context,
  planner,
  env,
}: {
  context: Rstest;
  planner: BrowserRunPlanner;
  env?: Record<string, string | undefined>;
}): BrowserWatchSession {
  let handles: BrowserWatchHandles | undefined;
  let initialRun: Promise<void> | undefined;
  const closeWatch = createBrowserWatchClose(() => handles);
  const close = async (): Promise<void> => {
    // A mixed watch returns control before the browser's initial cycle lands.
    // Settle that launch first so a config restart cannot miss late handles and
    // leave the old host alive after the next session starts.
    await initialRun?.catch(() => undefined);
    await closeWatch();
  };

  const start = () => {
    const projects = planner.getBrowserProjectsToRun();
    return runBrowserModeTests(context, projects, {
      ...planner.getWatchRunOptions(projects),
      env,
    });
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
    startBackground() {
      if (!planner.hasBrowserTestsToRun()) {
        return;
      }
      // One catch after the handler, not `then(onFulfilled, onRejected)`: the
      // rejection handler of a two-arg `then` cannot see the handler's own
      // failure, so a throwing initial-cycle landing would escape unhandled.
      initialRun = start()
        .then(landInitialCycle)
        .catch((error) => {
          logger.error(color.red('Browser Mode watch session failed:'), error);
          process.exitCode = 1;
        });
    },
    async runForeground() {
      try {
        const result = await start();
        await landInitialCycle(result);
        if (result?.watch) {
          await attachBrowserWatchControls(context, {
            ...result.watch,
            close,
          });
        } else {
          await close();
        }
      } catch (error) {
        await close();
        throw error;
      }
    },
    async rerun(testPaths) {
      await handles?.rerun(testPaths);
    },
    close,
  };
}
