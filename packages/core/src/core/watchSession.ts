import type { TestExecutor } from '../types';
import type { CoverageProvider } from '../types/coverage';
import {
  clearScreen,
  color,
  logger,
  type TraceController,
  type TraceEvent,
  type TraceRun,
} from '../utils';
import { FATAL_SIGNALS, getSignalExitCode } from '../utils/signals';
import { logWatchReadyMessage, type setupCliShortcuts } from './cliShortcuts';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunStart,
  runLifecycleStep,
} from './finalizeRun';
import type { Rstest } from './rstest';
import {
  collectFailedTestPaths,
  collectUnmatchedSnapshotTestPaths,
  prepareWatchRerunState,
} from './watchState';

export type WatchCycleOptions = {
  mode?: 'all' | 'on-demand';
  fileFilters?: string[];
};

/**
 * The one place a watch cycle happens, for every executor and every trigger
 * (dev rebuild, HMR, CLI shortcut, in-page rerun button).
 */
export interface WatchCycleDriver {
  runCycle(executor: TestExecutor, options?: WatchCycleOptions): Promise<void>;
}

export function createWatchCycleDriver({
  context,
  coverageProvider,
  traceController,
  getTraceRun,
  setTraceRun,
  enableCliShortcuts,
  isSessionLive = () => true,
}: {
  context: Rstest;
  coverageProvider: CoverageProvider | null;
  traceController: TraceController;
  getTraceRun: () => TraceRun;
  setTraceRun: (traceRun: TraceRun) => void;
  enableCliShortcuts: boolean;
  /**
   * Whether the run still has a session that could answer the ready banner. A
   * browser launch that found no test files (or failed before its runtime came
   * up) leaves none, and no trigger of any kind can fire afterwards — offering
   * to wait for file changes there would be a promise nothing can keep.
   */
  isSessionLive?: () => boolean;
}): WatchCycleDriver {
  let buildId = 0;
  // Reads the *current* buffer at emit time, so a browser cycle's events land
  // in the run buffer this loop rotated in for it.
  const onTraceEvents = context.trace
    ? (events: TraceEvent[]) => getTraceRun().onEvents?.(events)
    : undefined;
  // Serializes cycles across every executor: a node rebuild landing while a
  // browser rerun is mid-flight must not interleave with it on the shared
  // `stateManager`, which each cycle resets. The two split watch paths used to
  // make that impossible by construction; one loop has to make it impossible by
  // queueing.
  let tail: Promise<unknown> = Promise.resolve();

  const runOne = async (
    executor: TestExecutor,
    { mode = 'all', fileFilters }: WatchCycleOptions,
  ): Promise<void> => {
    // One id per cycle across all executors: consumers only require it to move
    // (the node pool flushes its worker cache on a change, the browser host
    // keys run-token staleness off it), never to be contiguous per executor.
    buildId += 1;
    prepareWatchRerunState(context);
    await notifyReportersOnTestRunStart(context);
    const outcome = await executor.runCycle({
      buildId,
      mode,
      fileFilters,
      // Read live per cycle, so a `u` rerun that flipped it is honored.
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
      onTraceEvents,
    });
    await finalizeRunCycle(context, {
      outcomes: [outcome],
      mode,
      isWatchMode: true,
      coverageProvider,
      reportOnFailure: context.normalizedConfig.coverage.reportOnFailure,
      traceRun: getTraceRun(),
    });
    // Pre-allocate the next cycle's buffer so events emitted between cycles are
    // not dropped.
    setTraceRun(traceController.beginRun());
    if (isSessionLive()) {
      logWatchReadyMessage(context, enableCliShortcuts);
    }
  };

  return {
    runCycle(executor, options = {}) {
      const cycle = tail.then(() => runOne(executor, options));
      // The caller still observes the rejection; the chain must not hand it to
      // the next trigger, which would wedge the session.
      tail = cycle.catch(() => {});
      return cycle;
    },
  };
}

/**
 * The executors a watch session drives, in teardown order. `node`/`browser` are
 * present only when that side has tests to run, which is what decides whether a
 * shortcut fans out to it — and, for `t`/`p`, whether the key is offered at all.
 */
export interface WatchSessionTargets {
  node?: {
    runCycle: (options?: WatchCycleOptions) => Promise<void>;
    /** Re-glob node entries for the `p` (file filter) shortcut. */
    globTestEntries: () => Promise<string[]>;
  };
  browser?: {
    /** Ask the browser host to schedule a cycle over these paths. */
    rerun: (testPaths?: string[]) => Promise<void>;
  };
}

/**
 * Build the watch-mode shortcut handlers — one implementation for every watch
 * shape: node-only, browser-only, and mixed. `t`/`p` scope the node side only
 * (the browser rerun pipeline takes no filter input), so a run without node
 * tests omits their callbacks and `setupCliShortcuts` renders greyed hints for
 * those keys instead.
 *
 * Returns the handler bag rather than installing it, so the caller keeps
 * `setupCliShortcuts` — the single stdin owner — as its own injection point.
 */
export function createWatchShortcutHandlers(
  context: Rstest,
  { node, browser }: WatchSessionTargets,
  close: () => Promise<void>,
): Parameters<typeof setupCliShortcuts>[0] {
  const { snapshotManager } = context;

  // Node cycle first, browser cycle second: each finalizes on its own, and that
  // output order is the shape a mixed watch shortcut has always produced.
  const fanOut = async (
    options: WatchCycleOptions,
    browserPaths?: string[],
  ): Promise<void> => {
    await node?.runCycle(options);
    await browser?.rerun(browserPaths);
  };

  return {
    closeServer: close,
    runAll: async () => {
      clearScreen();
      if (node) {
        // `t`/`p` scope the node side only, so only the node side has scoping
        // to drop when the user asks for every test again.
        context.normalizedConfig.testNamePattern = undefined;
        context.fileFilters = undefined;
        await node.runCycle({ mode: 'all' });
      }
      await browser?.rerun();
    },
    runWithTestNamePattern:
      node &&
      (async (pattern) => {
        clearScreen();
        context.normalizedConfig.testNamePattern = pattern;

        if (pattern) {
          logger.log(
            `\n${color.dim('Applied testNamePattern:')} ${color.bold(pattern)}\n`,
          );
        } else {
          logger.log(`\n${color.dim('Cleared testNamePattern filter')}\n`);
        }
        await node.runCycle();
      }),
    runWithFileFilters:
      node &&
      (async (filters) => {
        clearScreen();
        if (filters && filters.length > 0) {
          logger.log(
            `\n${color.dim('Applied file filters:')} ${color.bold(filters.join(', '))}\n`,
          );
        } else {
          logger.log(`\n${color.dim('Cleared file filters')}\n`);
        }
        context.fileFilters = filters;
        const entries = await node.globTestEntries();

        if (!entries.length) {
          logger.log(
            filters
              ? color.yellow(
                  `\nNo matching test files to run with current file filters: ${filters.join(',')}\n`,
                )
              : color.yellow('\nNo matching test files to run.\n'),
          );
          return;
        }
        await node.runCycle({ fileFilters: entries });
      }),
    runFailedTests: async () => {
      const failedTests = collectFailedTestPaths(context);

      if (!failedTests.length) {
        logger.log(
          color.yellow('\nNo failed tests were found that needed to be rerun.'),
        );
        return;
      }

      clearScreen();
      await fanOut({ fileFilters: failedTests, mode: 'all' }, failedTests);
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

      // The single save/restore for both sides: every cycle reads the live
      // value at dispatch, so it must stay flipped until both have finished and
      // must be restored even when one of them throws.
      const originalUpdateSnapshot = snapshotManager.options.updateSnapshot;
      snapshotManager.options.updateSnapshot = 'all';
      try {
        await fanOut({ fileFilters: unmatchedTests }, unmatchedTests);
      } finally {
        snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
      }
    },
  };
}

/**
 * The single idempotent teardown for a watch session, shared by the `q`
 * shortcut, the fatal-signal handler, and the config-change restart hook — so
 * none of them can drop an executor the others close.
 */
export function createWatchTeardown({
  executors,
  traceController,
  getTraceRun,
}: {
  /** Closed in order; the browser side goes first, as it always has. */
  executors: TestExecutor[];
  traceController: TraceController;
  getTraceRun: () => TraceRun;
}): () => Promise<void> {
  let isClosing: Promise<void> | undefined;

  const close = async (): Promise<void> => {
    try {
      for (const executor of executors) {
        await runLifecycleStep('executor cleanup', () => executor.close());
      }
      await runLifecycleStep('trace run finalize', () =>
        getTraceRun().finalize(),
      );
      await runLifecycleStep('trace controller cleanup', () =>
        traceController.close(),
      );
    } catch (error) {
      logger.log(color.red(`Error during cleanup: ${error}`));
    }
  };

  return () => {
    isClosing ??= close();
    return isClosing;
  };
}

/**
 * Own the fatal-signal → exit path for a watch session: tear down through the
 * shared teardown, then exit with the POSIX 128+signal code. Embedded hosts own
 * the process lifecycle, so nothing is registered there.
 */
export function registerWatchSignalExit(
  context: Rstest,
  close: () => Promise<void>,
): void {
  if (context.embedded) {
    return;
  }
  const handleSignal = async (signal: NodeJS.Signals) => {
    logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
    await close();
    process.exit(getSignalExitCode(signal));
  };
  for (const signal of FATAL_SIGNALS) {
    process.on(signal, handleSignal);
  }
}
