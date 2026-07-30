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
  /**
   * Whether a cycle has finalized yet. Shortcuts are installed before the first
   * one so the ready banner always has a stdin owner, which leaves a window
   * where a rerun key would reach executors that are still starting up.
   */
  hasFinalizedCycle(): boolean;
}

type PendingCycle = { options: WatchCycleOptions; cycle: Promise<void> };

/**
 * Merge a trigger into a queued cycle's scope so the result covers both.
 * Widening, never replacing: `'all'` beats `'on-demand'`, and an absent
 * `fileFilters` means "whatever this executor resolves at cycle time", which is
 * already broader than any explicit list.
 */
const widenScope = (
  queued: WatchCycleOptions,
  incoming: WatchCycleOptions,
): WatchCycleOptions => ({
  // An absent `mode` is `'all'` (the `runOne` default), so it widens too.
  mode:
    (queued.mode ?? 'all') === 'all' || (incoming.mode ?? 'all') === 'all'
      ? 'all'
      : 'on-demand',
  fileFilters:
    queued.fileFilters && incoming.fileFilters
      ? [...new Set([...queued.fileFilters, ...incoming.fileFilters])]
      : undefined,
});

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
  // Executors whose first cycle of this session has already been dispatched.
  const started = new Set<TestExecutor>();
  // Per executor, the cycle that is queued but has not started reading its
  // scope yet — the one a further trigger widens instead of queueing behind.
  const pending = new Map<TestExecutor, PendingCycle>();
  let finalizedACycle = false;

  const runOne = async (
    executor: TestExecutor,
    { mode = 'all', fileFilters }: WatchCycleOptions,
  ): Promise<void> => {
    // One id per cycle across all executors: consumers only require it to move
    // (the node pool flushes its worker cache on a change, the browser host
    // keys run-token staleness off it), never to be contiguous per executor.
    buildId += 1;
    // Skipped for an executor's first cycle: the session starts with clean
    // state, so there is nothing of its own to clear — and in a mixed run the
    // browser's first cycle lands after the node's, where a reset would wipe
    // the snapshot summary `u` reads and the press-u hint with it.
    if (started.has(executor)) {
      prepareWatchRerunState(context);
    } else {
      started.add(executor);
    }
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
    finalizedACycle = true;
    // Pre-allocate the next cycle's buffer so events emitted between cycles are
    // not dropped.
    setTraceRun(traceController.beginRun());
    if (isSessionLive()) {
      logWatchReadyMessage(context, enableCliShortcuts);
    }
  };

  return {
    runCycle(executor, options = {}) {
      // Coalesce into this executor's queued cycle that has not begun rather than
      // appending a second one. A burst of triggers (two quick saves, or one
      // `onAfterDevCompile` per browser project) would otherwise run the same
      // files back to back and print a summary each time. Merging is widening,
      // never latest-wins: the cycle must still cover everything every trigger
      // in the burst asked for.
      const queued = pending.get(executor);
      if (queued) {
        queued.options = widenScope(queued.options, options);
        return queued.cycle;
      }

      const entry: PendingCycle = { options, cycle: undefined as never };
      entry.cycle = tail.then(() => {
        // Dropped before the run, not after: from here the options are frozen,
        // so a trigger arriving mid-cycle queues its own cycle instead of
        // widening one that has already read its scope.
        pending.delete(executor);
        return runOne(executor, entry.options);
      });
      pending.set(executor, entry);
      // The caller still observes the rejection; the chain must not hand it to
      // the next trigger, which would wedge the session.
      tail = entry.cycle.catch(() => {});
      return entry.cycle;
    },
    hasFinalizedCycle: () => finalizedACycle,
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
  /**
   * Whether a cycle has finalized. Shortcuts are installed before the first one
   * (the ready banner must never appear without a stdin owner), so until it
   * lands a rerun key would reach a node side whose dev server is still coming
   * up — starting a second full startup run — or a browser side whose watch
   * session does not exist yet, which drops the keystroke in silence.
   */
  isArmed: () => boolean = () => true,
): Parameters<typeof setupCliShortcuts>[0] {
  const { snapshotManager } = context;

  const whenArmed = <A extends unknown[]>(
    handler: (...args: A) => Promise<void>,
  ): ((...args: A) => Promise<void>) => {
    return async (...args: A) => {
      if (!isArmed()) {
        logger.log(
          color.yellow('\nInitial run in progress, try again once it lands.'),
        );
        return;
      }
      await handler(...args);
    };
  };

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
    runAll: whenArmed(async () => {
      clearScreen();
      if (node) {
        // `t`/`p` scope the node side only, so only the node side has scoping
        // to drop when the user asks for every test again.
        context.normalizedConfig.testNamePattern = undefined;
        context.fileFilters = undefined;
        await node.runCycle({ mode: 'all' });
      }
      await browser?.rerun();
    }),
    runWithTestNamePattern:
      node &&
      whenArmed(async (pattern: string | undefined) => {
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
      whenArmed(async (filters: string[] | undefined) => {
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
    runFailedTests: whenArmed(async () => {
      const failedTests = collectFailedTestPaths(context);

      if (!failedTests.length) {
        logger.log(
          color.yellow('\nNo failed tests were found that needed to be rerun.'),
        );
        return;
      }

      clearScreen();
      await fanOut({ fileFilters: failedTests, mode: 'all' }, failedTests);
    }),
    updateSnapshot: whenArmed(async () => {
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
    }),
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

  // Each step is isolated and the trace steps run in `finally`, so one
  // executor's close cannot leave the executors behind it — or the trace files —
  // untouched. Teardown is the last thing that runs; a step that throws is
  // reported, never allowed to cancel the rest.
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await runLifecycleStep(label, fn);
    } catch (error) {
      logger.log(color.red(`Error during cleanup: ${error}`));
    }
  };

  const close = async (): Promise<void> => {
    try {
      for (const executor of executors) {
        await step('executor cleanup', () => executor.close());
      }
    } finally {
      await step('trace run finalize', () => getTraceRun().finalize());
      await step('trace controller cleanup', () => traceController.close());
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
