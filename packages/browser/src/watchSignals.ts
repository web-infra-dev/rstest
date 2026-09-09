import {
  color,
  type ExecutorInvalidationCallback,
  logger,
} from '@rstest/core/internal/browser';

/**
 * The handover between this host's rerun triggers and core's watch-cycle
 * driver. Triggers reach it from three unrelated places — the bundler's
 * dev-compile hook, a CLI shortcut's fanout, the in-page rerun button — and
 * only the ordering inside `signalInvalidation` keeps them from racing each
 * other. Each run branch installs the pieces it owns; nothing here knows which
 * branch is running.
 */
export type WatchSignals = ReturnType<typeof createWatchSignals>;

export const createWatchSignals = (
  onInvalidate: ExecutorInvalidationCallback | undefined,
) => {
  // The transport-owned rerun trigger, installed by whichever run branch
  // (headless/headed) is driving this run: resolve this rebuild's scope, then
  // hand it to core's invalidation subscriber. Populated after the initial
  // cycle.
  let dispatchRerun: (() => Promise<void>) | undefined;

  /**
   * Latest-wins interrupt, installed by the run branch whose in-flight run can
   * be cut short (headless). Core serializes cycles, so a trigger arriving
   * mid-cycle would otherwise wait out a run the user has already superseded.
   */
  let interruptInFlightRun: (() => Promise<void>) | undefined;

  /**
   * The cycle core is running for the scope last signalled. Only an explicit
   * request awaits it, right after it dispatched: a CLI shortcut's
   * `updateSnapshot` stays flipped only until `requestRerun` resolves, and the
   * in-page rerun button answers its RPC when the rerun is done. A rejection is
   * reported here rather than left to an awaiting caller, because compile-driven
   * triggers have no caller — and a failed cycle must not end the session.
   */
  let signalledCycle: Promise<void> | undefined;

  return {
    setDispatchRerun(fn: () => Promise<void>): void {
      dispatchRerun = fn;
    },
    async runDispatchRerun(): Promise<void> {
      await dispatchRerun?.();
    },
    setInterrupt(fn: () => Promise<void>): void {
      interruptInFlightRun = fn;
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
     * finalizes on results it never produced.
     */
    async signalInvalidation(
      fileFilters: string[],
      /**
       * Run state this trigger binds to its own paths, taken in the same turn as
       * the handover — after any interrupt, so no queued cycle can be dequeued in
       * between and read it. The headed rerun's per-file test-name pattern is the
       * one such state; core's cycle options cannot carry it, so the only thing
       * that makes it the property of one cycle is claiming it here.
       *
       * Returns a handle to the cycle THIS signal started (still not awaited
       * here — see above). A caller with state to restore must await the
       * returned `cycle` rather than `awaitSignalledCycle`: the shared slot
       * can be overwritten by a concurrent trigger between signal and wait.
       */
      claimScope?: () => void,
    ): Promise<{ cycle: Promise<void> }> {
      await interruptInFlightRun?.();
      claimScope?.();
      const cycle = Promise.resolve(
        onInvalidate?.({ isFirstBuild: false, fileFilters }),
      ).then(
        () => {},
        (error) => {
          logger.error(color.red('Browser Mode watch cycle failed:'), error);
        },
      );
      signalledCycle = cycle;
      return { cycle };
    },
    async awaitSignalledCycle(): Promise<void> {
      await signalledCycle;
    },
  };
};
