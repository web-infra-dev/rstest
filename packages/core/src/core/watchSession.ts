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
import { GLOBAL_TEARDOWN_ERROR, runGlobalTeardown } from './globalSetup';
import type { Rstest } from './rstest';
import {
  collectFailedTestPaths,
  collectUnmatchedSnapshotTestPaths,
  prepareWatchCycleState,
} from './watchState';

/**
 * What asked for a cycle. Two triggers fold into one cycle only when they are
 * the same kind asking the same thing (see {@link canFold}), so this is the
 * identity that decides it — not the option shape, which several kinds share.
 *
 * `'invalidation'` is a transport's own signal (a dev rebuild, an HMR update,
 * the browser host's file-set diff); the rest are the CLI shortcuts whose whole
 * request lives in the options object — on the node side. The browser host
 * resolves every trigger it owns through the same file-set diff, a shortcut's
 * `requestRerun` included, so every browser cycle arrives as `'invalidation'`
 * and this identity cannot separate them. Harmless only while the browser
 * executor drops the one option a fold could leak; see
 * {@link WatchCycleOptions.updateSnapshot}. The `t`/`p` shortcuts and the browser
 * initial cycle carry no trigger and so never fold: `t`/`p` bind a pattern or
 * filter that lives on `context`, outside the options a fold would union, so
 * two of them are not the same request even when their options match. (The node
 * initial cycle is not in that group — it arrives as `'invalidation'`, because
 * the initial compile is what signals it — but nothing can be queued behind an
 * executor before its first cycle, so it folds with nothing reachable either.)
 */
export type WatchCycleTrigger =
  'invalidation' | 'run-all' | 'run-failed' | 'update-snapshot';

export type WatchCycleOptions = {
  mode?: 'all' | 'on-demand';
  fileFilters?: string[];
  trigger?: WatchCycleTrigger;
  /**
   * Only for a trigger that asks for one, which is the `u` shortcut. Left out,
   * a cycle takes the session's configured value — the `u` handler also flips
   * the live `snapshotManager` flag, for the browser host's per-page reads, and
   * a node cycle no `u` selected files for must not pick that flip up and
   * rewrite their snapshots.
   *
   * Node-side only, and the qualifier is load-bearing: the browser executor
   * drops this option on a watch rerun and its host re-reads the live flag per
   * page load, so a browser cycle queued inside the `u` hold window still runs
   * under `'all'`. Recorded at the drop site in `browserExecutor.runCycle`,
   * together with the fold hazard that closing it has to settle: trigger kind is
   * erased on the browser side, so nothing here can tell a `u` rerun from a
   * rebuild, and a cycle that honored this option without also making that
   * difference visible would fold the two.
   */
  updateSnapshot?: SnapshotUpdateState;
  /**
   * Post-globalSetup env change-set, produced by the core-owned pre-cycle
   * globalSetup stage. Set on the session's initial browser cycle only — that
   * cycle is the host launch, and the host keeps the change-set for the whole
   * session. The node executor ignores this field because its pool composes the
   * same context-local overlay at dispatch.
   */
  env?: Record<string, string | undefined>;
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
  /**
   * Resolved once, when this trigger queued its cycle — never re-read at
   * dispatch. `updateSnapshot` is why: the `u` shortcut flips the live flag
   * around the cycles it asks for, so a cycle reading it at dispatch could
   * inherit a flag no trigger of its own set and rewrite the snapshots of every
   * file it happens to run.
   */
  options: WatchCycleOptions & { updateSnapshot: SnapshotUpdateState };
  cycle: Promise<void>;
  /**
   * Whether a further trigger may still fold into this cycle. Owned by the
   * entry rather than compared against a per-executor slot, so a cycle can only
   * ever close its own window: an earlier cycle reaching the queue's head after
   * a later trigger queued its own has no way to express closing that one.
   */
  isOpen: boolean;
};

/**
 * Whether a trigger may fold its request into a queued cycle instead of
 * queueing its own behind it, so a burst becomes one answer rather than the
 * same files run back to back with a summary each time.
 *
 * Two triggers fold when they are the same {@link WatchCycleTrigger} asking the
 * same thing: same `mode`, same resolved `updateSnapshot`, and agreeing on
 * whether they brought a file list. That covers the two bursts a user can
 * actually produce — quick saves (one `onAfterDevCompile` per browser project,
 * or two edits inside one cycle) and a held-down `a`/`f`/`u`, which is
 * fire-and-forget from the stdin owner and so queues one cycle per press.
 *
 * Different kinds never fold, and neither does a kind that carries no trigger.
 * A shortcut binds state to the file list it chose, so folding across kinds
 * would apply one kind's state to files the other selected — `u`'s
 * snapshot-update flag is the destructive case. `t`/`p` carry no trigger at all
 * because the pattern and filter they bind live on `context`, outside the
 * options object: two `t` presses can have identical options and still be
 * different requests, so identity here cannot see the difference.
 *
 * Folding is then a plain union of the file lists, the one thing two same-kind
 * triggers disagree on. Both lists have to be there to union: an absent list
 * means the executor resolves its own scope at cycle time, which is not the
 * broader scope it looks like — the node side pulls the entries its rebuild
 * affected, while the browser side reads it as no files at all.
 *
 * Keeping the kinds apart costs one empty summary in a narrow order: an
 * unfiltered shortcut cycle queued ahead of an invalidation cycle runs
 * everything and consumes the rebuild's diff on its way (the node side pulls
 * `calcEntriesToRerun` every cycle, and each pull advances the baseline),
 * leaving the invalidation cycle nothing to run. Accepted over a fold exception
 * for `mode: 'all'`, which would need exactly the executor-shape awareness this
 * predicate exists to avoid. The reverse order is unaffected.
 */
const canFold = (
  queued: PendingCycle['options'],
  incoming: PendingCycle['options'],
): boolean =>
  queued.trigger !== undefined &&
  queued.trigger === incoming.trigger &&
  queued.mode === incoming.mode &&
  queued.updateSnapshot === incoming.updateSnapshot &&
  !!queued.fileFilters === !!incoming.fileFilters;

export function createWatchCycleDriver({
  context,
  coverageProvider,
  traceController,
  getTraceRun,
  setTraceRun,
  enableCliShortcuts,
  isSessionLive,
  isSessionClosing,
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
  isSessionLive: () => boolean;
  /**
   * Whether the session teardown has started. A queued cycle must stop before
   * touching shared state or a closed executor. A cycle already in flight when
   * teardown starts produces results about the teardown, not about the tests:
   * the node pool rejects its running task with a worker-stopped error as it
   * shuts down. Finalizing that would report a failure the user never caused —
   * and, on a config-change restart, the exit code it writes outlives the
   * session and fails the run that replaces it.
   */
  isSessionClosing: () => boolean;
}): WatchCycleDriver {
  let buildId = 0;
  // The session's configured value, read before any cycle can run. The `u`
  // shortcut is the only thing that ever writes the live flag, and it writes it
  // for the browser host's per-page reads — so this, not the live read, is what
  // a cycle without an explicit `updateSnapshot` is entitled to.
  const sessionUpdateSnapshot = context.snapshotManager.options.updateSnapshot;
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
  // Per executor, the cycle queued most recently that has not started reading
  // its scope yet — the one a further invalidation folds into instead of
  // queueing behind.
  const pending = new Map<TestExecutor, PendingCycle>();
  // Executors whose first cycle has settled, so a shortcut key can reach them.
  // Doubles as the first-cycle discriminator below: `tail` serializes every
  // cycle across every executor, so anything dispatched earlier has already
  // reached its `finally` by the time the next one asks.
  const settled = new Set<TestExecutor>();

  const runOne = async (
    executor: TestExecutor,
    {
      options: { mode = 'all', fileFilters, trigger, updateSnapshot, env },
    }: PendingCycle,
  ): Promise<void> => {
    if (isSessionClosing()) {
      return;
    }
    // One id per cycle across all executors: consumers only require it to move
    // (the node pool flushes its worker cache on a change, the browser host
    // keys run-token staleness off it), never to be contiguous per executor.
    buildId += 1;
    // What a first cycle skips is the snapshot half only; see
    // `prepareWatchCycleState` for why the two halves part ways there.
    const isFirstCycle = !settled.has(executor);
    prepareWatchCycleState(context, { isFirstCycle });
    try {
      await notifyReportersOnTestRunStart(context);
      const outcome = await executor.runCycle({
        buildId,
        mode,
        fileFilters,
        fromInvalidation: trigger === 'invalidation',
        updateSnapshot,
        env,
        onTraceEvents,
      });
      if (isSessionClosing()) {
        return;
      }
      await finalizeRunCycle(context, {
        outcomes: [outcome],
        mode,
        isWatchMode: true,
        coverageProvider,
        reportOnFailure: context.normalizedConfig.coverage.reportOnFailure,
        traceRun: getTraceRun(),
      });
      context.exitCode.finishCycle();
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
      const resolved = {
        ...options,
        updateSnapshot: options.updateSnapshot ?? sessionUpdateSnapshot,
      };
      // Fold into this executor's queued cycle that has not begun rather than
      // appending a second one. Union, never latest-wins: the folded cycle must
      // still cover every file the burst asked for.
      const queued = pending.get(executor);
      if (queued?.isOpen && canFold(queued.options, resolved)) {
        const { fileFilters } = queued.options;
        if (fileFilters && resolved.fileFilters) {
          queued.options.fileFilters = [
            ...new Set([...fileFilters, ...resolved.fileFilters]),
          ];
        }
        // Absent on both sides (`canFold` requires they agree): no list to union.
        return queued.cycle;
      }

      const entry: PendingCycle = {
        options: resolved,
        cycle: undefined as never,
        isOpen: true,
      };
      entry.cycle = tail.then(() => {
        // Closed before the run, not after: from here the options are frozen,
        // so a trigger arriving mid-cycle queues its own cycle instead of
        // folding into one that has already read its scope.
        entry.isOpen = false;
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
    /** Select node entries for the `p` (file filter) shortcut. */
    globTestEntries: (filters?: string[]) => Promise<string[]>;
    /** Persist the node-only file selection for later invalidation cycles. */
    setFileFilters: (fileFilters: string[] | undefined) => void;
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
   * included: `p` queues no browser cycle, and its selected paths stay on the
   * node target. `t`'s pattern crosses the seam only inside the runtime config
   * the host projects at launch, so a `t` pressed later never reaches the
   * browser side at all.
   */
  isArmed: () => boolean = () => true,
): Parameters<typeof setupCliShortcuts>[0] {
  const { snapshotManager } = context;
  let updateSnapshotHolds = 0;
  let updateSnapshotBeforeHold: SnapshotUpdateState;

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
      context.normalizedConfig.testNamePattern = undefined;
      context.fileFilters = undefined;
      if (node) {
        node.setFileFilters(undefined);
        await node.runCycle({ mode: 'all', trigger: 'run-all' });
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

        const entries = await node.globTestEntries(filters);
        node.setFileFilters(filters ? entries : undefined);

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
      await fanOut(
        { fileFilters: failedTests, mode: 'all', trigger: 'run-failed' },
        failedTests,
      );
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

      // The live flip is for the browser host alone, which re-reads the flag for
      // every page it loads; the node side takes it as a cycle option instead, so
      // it reaches only the files this trigger chose. It must span both cycles
      // and survive either throwing.
      //
      // Counted, because this handler is re-entrant: the stdin owner dispatches
      // fire-and-forget, so a second `u` pressed while the first still awaits
      // its cycles would save the flag the first one already flipped and restore
      // `'all'` over it — leaving every later cycle rewriting snapshots.
      if (updateSnapshotHolds++ === 0) {
        updateSnapshotBeforeHold = snapshotManager.options.updateSnapshot;
        snapshotManager.options.updateSnapshot = 'all';
      }
      try {
        await fanOut(
          {
            fileFilters: unmatchedTests,
            trigger: 'update-snapshot',
            updateSnapshot: 'all',
          },
          unmatchedTests,
        );
      } finally {
        if (--updateSnapshotHolds === 0) {
          snapshotManager.options.updateSnapshot = updateSnapshotBeforeHold;
        }
      }
    }),
  };
}

/**
 * The single idempotent teardown for a watch session, shared by the `q`
 * shortcut, the fatal-signal handler, and the config-change restart hook — so
 * none of them can drop an executor the others close.
 */
export interface WatchTeardown {
  close(): Promise<void>;
  /**
   * Record a startup phase that runs before any executor can be closed
   * meaningfully — today the browser globalSetup stage. A close arriving while
   * one is in flight (a config-change restart, Ctrl+C) settles it first, so the
   * teardown that follows sees the state the phase produced instead of racing
   * it: a setup whose teardown callback is still being registered would
   * otherwise never be drained, and the replacement session would start on top
   * of it.
   */
  track<T>(pending: Promise<T>): Promise<T>;
  /**
   * Whether a close has been requested. A tracked phase must check this before
   * starting the next one — the close it lost the race to has already run.
   */
  isClosing(): boolean;
  /**
   * Release a process-level owner once teardown has settled, never before: the
   * stdin owner keeps the loop alive, while fatal-signal handlers must remain
   * answerable during cleanup without leaking into the next session.
   */
  addCleanup(cleanup: () => void): void;
}

export function createWatchTeardown({
  context,
  executors,
  traceController,
  getTraceRun,
}: {
  context: Rstest;
  /** Closed in order; the browser side goes first, as it always has. */
  executors: TestExecutor[];
  traceController: TraceController;
  getTraceRun: () => TraceRun;
}): WatchTeardown {
  let closePromise: Promise<void> | undefined;
  let closeRequested = false;
  let pending: Promise<unknown> | undefined;
  const cleanups: Array<() => void> = [];

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
      // The phase's own rejection is the caller's to report; here it only has
      // to be settled.
      await pending?.catch(() => undefined);
      for (const executor of executors) {
        await step('executor cleanup', () => executor.close());
      }
      // The watch session owns the shared queue and drains it only after every
      // executor has closed.
      const teardownSucceeded = await runGlobalTeardown(context);
      if (!teardownSucceeded) {
        throw new Error(GLOBAL_TEARDOWN_ERROR);
      }
    } finally {
      try {
        await step('trace run finalize', () => getTraceRun().finalize());
        await step('trace controller cleanup', () => traceController.close());
      } finally {
        for (const cleanup of cleanups.splice(0)) {
          cleanup();
        }
      }
    }
  };

  return {
    close() {
      closeRequested = true;
      closePromise ??= close();
      return closePromise;
    },
    track(nextPending) {
      pending = nextPending;
      return nextPending;
    },
    isClosing: () => closeRequested,
    addCleanup(cleanup) {
      if (closePromise) {
        void closePromise.then(cleanup, cleanup);
      } else {
        cleanups.push(cleanup);
      }
    },
  };
}

/**
 * Own the fatal-signal → exit path for a watch session: tear down through the
 * shared teardown, then exit with the POSIX 128+signal code. Embedded hosts own
 * the process lifecycle, so nothing is registered there. The returned cleanup
 * removes this session's handlers after teardown completes.
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
