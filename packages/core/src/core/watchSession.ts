import type { SnapshotUpdateState } from '@vitest/snapshot';
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
  prepareWatchCycleState,
} from './watchState';

export type WatchCycleOptions = {
  mode?: 'all' | 'on-demand';
  fileFilters?: string[];
  /**
   * Whether this trigger is a transport's own invalidation signal (a dev
   * rebuild, an HMR update, the browser host's file-set diff) rather than
   * something core queued directly — a CLI shortcut, or the session's initial
   * cycle. Only invalidation signals fold into each other; see {@link canFold}.
   */
  fromInvalidation?: boolean;
};

/**
 * The one place a watch cycle happens, for every executor and every trigger
 * (dev rebuild, HMR, CLI shortcut, in-page rerun button).
 */
export interface WatchCycleDriver {
  runCycle(executor: TestExecutor, options?: WatchCycleOptions): Promise<void>;
  /**
   * Whether every one of `executors` has settled its first cycle of this
   * session. Shortcuts are installed before the first one so the ready banner
   * always has a stdin owner, which leaves a window where a rerun key would
   * reach executors that are still starting up — and the two sides of a mixed
   * run leave it independently. The node initial cycle landing says nothing about
   * the browser host, whose watch session does not exist until its own initial
   * cycle boots the runtime, so a shortcut is answerable only once every side of
   * the run is past startup.
   *
   * Settled, not succeeded: a first cycle that threw is as done starting up as
   * one that passed, and it reported itself. Waiting for it to succeed would
   * gate every key on a side that can never answer — in a mixed run, a browser
   * boot failure would leave the healthy node side with no key it answers at
   * all, only a file save.
   */
  hasSettledCycle(executors: TestExecutor[]): boolean;
}

type PendingCycle = {
  options: WatchCycleOptions;
  /**
   * `updateSnapshot` as it stood when this trigger queued its cycle, not as it
   * stands when the cycle is dequeued. The `u` shortcut flips it to `'all'`
   * around the cycles it asks for, so a cycle that read it at dispatch could
   * inherit a flag no trigger of its own set and rewrite the snapshots of every
   * file it happens to run.
   */
  updateSnapshot: SnapshotUpdateState;
  cycle: Promise<void>;
};

/**
 * Whether a trigger may fold its scope into a queued cycle instead of queueing
 * its own behind it.
 *
 * Only a transport's own invalidation signals may, and only ones asking the same
 * question: what changed since the last cycle, in this `mode`? A burst of those
 * (two quick saves, one `onAfterDevCompile` per browser project) then collapses
 * into a single answer instead of running the same files back to back and
 * printing a summary each time. What core queues directly must not fold — a
 * shortcut binds state to the file list it chose (`u`'s snapshot-update flag,
 * the filter `p` just printed), so folding it would apply that state to files
 * no trigger of theirs ever selected.
 *
 * Folding two such signals is then a plain union of their file lists, the one
 * thing they disagree on. Both lists have to be there to union: an absent list
 * means the executor resolves its own scope at cycle time, which is not the
 * broader scope it looks like — the node side pulls the entries its rebuild
 * affected, while the browser side reads it as no files at all.
 *
 * Refusing to fold across the two kinds costs one empty summary in a narrow
 * order: an unfiltered shortcut cycle queued ahead of an invalidation cycle
 * runs everything and consumes the rebuild's diff on its way (the node side
 * pulls `calcEntriesToRerun` every cycle, and each pull advances the baseline),
 * leaving the invalidation cycle nothing to run. Accepted over a fold exception
 * for `mode: 'all'`, which would need exactly the executor-shape awareness this
 * predicate exists to avoid. The reverse order is unaffected.
 */
const canFold = (
  queued: WatchCycleOptions,
  incoming: WatchCycleOptions,
): boolean =>
  !!queued.fromInvalidation &&
  !!incoming.fromInvalidation &&
  queued.mode === incoming.mode &&
  !!queued.fileFilters === !!incoming.fileFilters;

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
  // Per executor, the cycle queued most recently that has not started reading
  // its scope yet — the one a further invalidation folds into instead of
  // queueing behind.
  const pending = new Map<TestExecutor, PendingCycle>();
  // Executors whose first cycle has settled, so a shortcut key can reach them.
  const settled = new Set<TestExecutor>();

  const runOne = async (
    executor: TestExecutor,
    {
      options: { mode = 'all', fileFilters, fromInvalidation },
      updateSnapshot,
    }: PendingCycle,
  ): Promise<void> => {
    // One id per cycle across all executors: consumers only require it to move
    // (the node pool flushes its worker cache on a change, the browser host
    // keys run-token staleness off it), never to be contiguous per executor.
    buildId += 1;
    // What a first cycle skips is the snapshot half only; see
    // `prepareWatchCycleState` for why the two halves part ways there.
    const isFirstCycle = !started.has(executor);
    started.add(executor);
    prepareWatchCycleState(context, { isFirstCycle });
    try {
      await notifyReportersOnTestRunStart(context);
      const outcome = await executor.runCycle({
        buildId,
        mode,
        fileFilters,
        fromInvalidation,
        updateSnapshot,
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
    } finally {
      // In `finally`, so a startup that failed still counts as past startup —
      // see {@link WatchCycleDriver.hasSettledCycle}. The caller keeps the
      // rejection; what must not happen is a rerun key gated on a cycle that
      // will never come back.
      settled.add(executor);
    }
    // Pre-allocate the next cycle's buffer so events emitted between cycles are
    // not dropped.
    setTraceRun(traceController.beginRun());
    if (isSessionLive()) {
      logWatchReadyMessage(context, enableCliShortcuts);
    }
  };

  return {
    runCycle(executor, options = {}) {
      // Fold into this executor's queued cycle that has not begun rather than
      // appending a second one. Union, never latest-wins: the folded cycle must
      // still cover every file the burst asked for.
      const queued = pending.get(executor);
      if (queued && canFold(queued.options, options)) {
        const { fileFilters } = queued.options;
        if (fileFilters && options.fileFilters) {
          queued.options.fileFilters = [
            ...new Set([...fileFilters, ...options.fileFilters]),
          ];
        }
        // Absent on both sides (`canFold` requires they agree): no list to union.
        return queued.cycle;
      }

      const entry: PendingCycle = {
        options: { ...options },
        updateSnapshot: context.snapshotManager.options.updateSnapshot,
        cycle: undefined as never,
      };
      entry.cycle = tail.then(() => {
        // Dropped before the run, not after: from here the options are frozen,
        // so a trigger arriving mid-cycle queues its own cycle instead of
        // folding into one that has already read its scope.
        pending.delete(executor);
        return runOne(executor, entry);
      });
      pending.set(executor, entry);
      // The caller still observes the rejection; the chain must not hand it to
      // the next trigger, which would wedge the session.
      tail = entry.cycle.catch(() => {});
      return entry.cycle;
    },
    hasSettledCycle: (executors) =>
      executors.every((executor) => settled.has(executor)),
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
   * Whether every executor of this run is past its first cycle. Shortcuts are
   * installed before that (the ready banner must never appear without a stdin
   * owner), so until it lands a rerun key would reach a node side whose dev
   * server is still coming up — starting a second full startup run — or a
   * browser side whose watch session does not exist yet, which drops the
   * keystroke in silence. One gate covers every key, the node-only `t`/`p`
   * included: `p` queues no browser cycle, but it writes `context.fileFilters`,
   * which the browser host re-reads while collecting the entries for its next
   * one. `t`'s pattern crosses the seam only inside the runtime config the host
   * projects at launch, so a `t` pressed later never reaches the browser side
   * at all.
   */
  isArmed: () => boolean = () => true,
): Parameters<typeof setupCliShortcuts>[0] {
  const { snapshotManager } = context;

  const canRerun = (): boolean => {
    if (isArmed()) {
      return true;
    }
    logger.log(
      color.yellow('\nInitial run in progress, try again once it lands.'),
    );
    return false;
  };

  const whenArmed = <A extends unknown[]>(
    handler: (...args: A) => Promise<void>,
  ): ((...args: A) => Promise<void>) => {
    return async (...args: A) => {
      if (!canRerun()) {
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
    canRerun,
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

      // The single save/restore for both sides. It has to span both cycles, not
      // just the calls that queue them: the node side takes the value this
      // trigger queued its cycle with, while the browser host re-reads the live
      // one for every page it loads. And it must be restored even when one of
      // the two throws.
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
