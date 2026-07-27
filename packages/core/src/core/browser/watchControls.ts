import type { BrowserWatchHandles } from '../../types';
import { clearScreen, color, logger } from '../../utils';
import { FATAL_SIGNALS, getSignalExitCode } from '../../utils/signals';
import { runBrowserModeTests } from './loader';
import type { BrowserRunPlanner } from './runPlanner';
import { isCliShortcutsEnabled, setupCliShortcuts } from '../cliShortcuts';
import { runLifecycleStep } from '../finalizeRun';
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
): void {
  if (context.embedded) {
    return;
  }
  const handleSignal = async (signal: NodeJS.Signals) => {
    logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
    await runLifecycleStep('browser watch cleanup', () => watch.close());
    process.exit(getSignalExitCode(signal));
  };
  for (const signal of FATAL_SIGNALS) {
    process.on(signal, handleSignal);
  }
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
    closeServer: async () => {
      await runLifecycleStep('browser watch cleanup', () => watch.close());
    },
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

/**
 * Attach core-owned controls to a browser-only watch session: the fatal-signal
 * exit path first, then the single stdin shortcuts owner. No-op when the run
 * produced no watch handles.
 */
export async function attachBrowserWatchControls(
  context: Rstest,
  watch: BrowserWatchHandles | undefined,
): Promise<void> {
  if (!watch) {
    return;
  }
  registerBrowserWatchSignalExit(context, watch);
  await setupBrowserWatchShortcuts(context, watch);
}

/**
 * The browser side of a mixed watch run, wrapped so the orchestrator never
 * tracks {@link BrowserWatchHandles} directly. The session is host-driven and
 * self-finalizing; `rerun`/`close` are safe no-ops until the initial run lands
 * the handles.
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
}: {
  context: Rstest;
  planner: BrowserRunPlanner;
}): BrowserWatchSession {
  let handles: BrowserWatchHandles | undefined;

  const start = () => {
    const projects = planner.getBrowserProjectsToRun();
    return runBrowserModeTests(
      context,
      projects,
      planner.getWatchRunOptions(projects),
    );
  };

  return {
    startBackground() {
      if (!planner.hasBrowserTestsToRun()) {
        return;
      }
      start().then(
        (result) => {
          handles = result?.watch;
        },
        (error) => {
          logger.error(
            color.red('Browser Mode watch session failed to start:'),
            error,
          );
          process.exitCode = 1;
        },
      );
    },
    async runForeground() {
      const result = await start();
      handles = result?.watch;
      await attachBrowserWatchControls(context, result?.watch);
    },
    async rerun(testPaths) {
      await handles?.rerun(testPaths);
    },
    async close() {
      // Snapshot the handle locally: it lands asynchronously after the initial
      // browser run resolves.
      const current = handles;
      if (current) {
        await runLifecycleStep('browser watch cleanup', () => current.close());
      }
    },
  };
}
