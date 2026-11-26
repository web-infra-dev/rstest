import {
  color,
  type ExecutorInvalidationCallback,
  logger,
} from '@rstest/core/internal/browser';
import type { SnapshotUpdateState } from '@vitest/snapshot';

/**
 * The handover between this host's rerun triggers and core's watch-cycle
 * driver. Triggers reach it from three unrelated places — the bundler's
 * dev-compile hook, a CLI shortcut's fanout, the in-page rerun button — and
 * only the ordering inside `signalInvalidation` keeps them from racing each
 * other. Each run branch installs the pieces it owns; nothing here knows which
 * branch is running.
 */
export type WatchSignals = ReturnType<typeof createWatchSignals>;
export type RequestedTestPaths = string[] | 'all';

export const createWatchSignals = (
  onInvalidate: ExecutorInvalidationCallback | undefined,
) => {
  // The transport-owned rerun trigger, installed by whichever run branch
  // (headless/headed) is driving this run: resolve this rebuild's scope, then
  // hand it to core's invalidation subscriber. Populated after the initial
  // cycle.
  let dispatchRerun:
    | ((
        updateSnapshot?: SnapshotUpdateState,
        requestedTestPaths?: RequestedTestPaths,
      ) => Promise<void>)
    | undefined;

  /**
   * Latest-wins interrupts installed by active lanes (headless cancels its
   * in-flight run; headed skips remaining queued files in the superseded
   * cycle). Each handler carries its lane scope (`'headless'` or a headed
   * `containerId`) so container-scoped UI reruns interrupt only their own
   * lane without cancelling sibling work.
   */
  const interruptHandlers: Array<{
    scope: string;
    fn: () => Promise<void> | void;
  }> = [];
  const abortHandlers: Array<() => Promise<void> | void> = [];

  const runInterrupts = async (
    scope: 'all' | string = 'all',
  ): Promise<void> => {
    const matching =
      scope === 'all'
        ? interruptHandlers
        : interruptHandlers.filter((entry) => entry.scope === scope);
    await Promise.all(matching.map((entry) => entry.fn()));
  };

  /**
   * The cycle core is running for the scope last signalled. Only an explicit
   * request awaits it, right after it dispatched: a CLI shortcut's
   * `updateSnapshot` stays flipped only until `requestRerun` resolves, and the
   * in-page rerun button answers its RPC when the rerun is done. A rejection is
   * reported here rather than left to an awaiting caller, because compile-driven
   * triggers have no caller — and a failed cycle must not end the session.
   */
  let signalledCycle: Promise<void> | undefined;

  const runInvalidation = (
    fileFilters: string[],
    updateSnapshot?: SnapshotUpdateState,
  ): { rawCycle: unknown; cycle: Promise<void> } => {
    const rawCycle = onInvalidate?.({
      isFirstBuild: false,
      fileFilters,
      ...(updateSnapshot === undefined ? {} : { updateSnapshot }),
    });
    const cycle = Promise.resolve(rawCycle).then(
      () => {},
      (error) => {
        logger.error(color.red('Browser Mode watch cycle failed:'), error);
      },
    );
    return { rawCycle, cycle };
  };

  return {
    setDispatchRerun(
      fn: (
        updateSnapshot?: SnapshotUpdateState,
        requestedTestPaths?: RequestedTestPaths,
      ) => Promise<void>,
    ): void {
      dispatchRerun = fn;
    },
    async runDispatchRerun(
      updateSnapshot?: SnapshotUpdateState,
      requestedTestPaths?: RequestedTestPaths,
    ): Promise<void> {
      await dispatchRerun?.(updateSnapshot, requestedTestPaths);
    },
    addInterrupt(fn: () => Promise<void> | void, scope = 'all'): void {
      interruptHandlers.push({ scope, fn });
    },
    async interrupt(scope: 'all' | string = 'all'): Promise<void> {
      await runInterrupts(scope);
    },
    addAbort(fn: () => Promise<void> | void): void {
      abortHandlers.push(fn);
    },
    async abort(): Promise<void> {
      await Promise.all(abortHandlers.map((fn) => fn()));
    },
    /**
     * Hand the scope this trigger resolved to core, which resets the cycle state,
     * calls back into the session's `runCycle`, and finalizes.
     *
     * The cycle is deliberately *not* awaited here. Rebuild triggers reach this
     * from inside the bundler's dev-compile hook, and the bundler keeps no
     * watcher attached while that hook is pending: anything created or deleted in
     * that window is never seen, so it never rebuilds and never reruns. Holding
     * the hook for a whole cycle widens that blind window to the cycle's full
     * duration, which loses test files added or removed mid-run for good. Core
     * serializes the cycles itself, so nothing here has to.
     *
     * The in-flight run is cut short here rather than at the trigger, because only
     * this point knows a replacement cycle is actually coming: a trigger that
     * resolves to no affected files must leave the running cycle alone, or it
     * finalizes on results it never produced. `interruptScope` restricts
     * interruption to the triggering lane for container-scoped UI reruns so
     * sibling lanes' in-flight work is never dropped.
     */
    async signalInvalidation(
      fileFilters: string[],
      /**
       * Invoked synchronously immediately after core's `onInvalidate` returns
       * the raw queued cycle handle (before any microtask can start `runCycle`).
       * Core returns the same promise when it folds into an open queued cycle
       * and a new promise when it queues a separate cycle (e.g. differing
       * `updateSnapshot` policies), allowing the coordinator to bind container
       * targets and test-name patterns to the exact queued cycle.
       */
      onSignalled?: (rawCycle: unknown) => void,
      updateSnapshot?: SnapshotUpdateState,
      interruptScope: 'all' | string = 'all',
    ): Promise<{ cycle: Promise<void> }> {
      await runInterrupts(interruptScope);
      const { rawCycle, cycle } = runInvalidation(fileFilters, updateSnapshot);
      onSignalled?.(rawCycle);
      signalledCycle = cycle;
      return { cycle };
    },
    queueInvalidationAfter(
      cycle: Promise<void>,
      fileFilters: string[],
      updateSnapshot?: SnapshotUpdateState,
      onSignalled?: (rawCycle: unknown) => void,
    ): void {
      signalledCycle = cycle.then(() => {
        const next = runInvalidation(fileFilters, updateSnapshot);
        onSignalled?.(next.rawCycle);
        return next.cycle;
      });
    },
    async awaitSignalledCycle(): Promise<void> {
      await signalledCycle;
    },
  };
};
