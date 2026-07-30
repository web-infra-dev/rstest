import type { RstestContext } from '../types';

/**
 * Reset what a watch cycle must not inherit, before either executor streams
 * events into it. Core's watch cycle driver is the only caller, ahead of every
 * cycle of every transport, which is what keeps the reset from drifting per
 * watch shape.
 *
 * The two halves differ on a session's first cycle, and the difference is the
 * mixed-watch startup order: the node initial cycle finalizes, then the browser
 * initial cycle runs.
 *
 * `stateManager` is cleared for every cycle, first one included. The node pool
 * and the browser host feed the same one through the shared `RunnerEventSink`,
 * and its failure count is what both `bail` gates read — leave the node initial
 * cycle's failures standing and a `bail` limit already reached drains every
 * browser file as skipped before the browser session has run a single test.
 *
 * `snapshotManager` is cleared only for a rerun, because its summary is
 * cross-cycle by design: the `u` shortcut and the press-u hint read the summary
 * whichever cycle ran last produced. Clearing it on the browser's first cycle
 * would throw away the node cycle's summary before the user could act on it.
 */
export function prepareWatchCycleState(
  context: RstestContext,
  { isFirstCycle }: { isFirstCycle: boolean },
): void {
  context.stateManager.reset();
  if (!isFirstCycle) {
    context.snapshotManager.clear();
  }
}

/** Test paths whose latest run failed — the `f` shortcut's rerun set. */
export const collectFailedTestPaths = (context: RstestContext): string[] =>
  context.reporterResults.results
    .filter((result) => result.status === 'fail')
    .map((result) => result.testPath);

/** Test paths with unmatched snapshots — the `u` shortcut's rerun set. */
export const collectUnmatchedSnapshotTestPaths = (
  context: RstestContext,
): string[] =>
  context.reporterResults.results
    .filter((result) => result.snapshotResult?.unmatched)
    .map((result) => result.testPath);
