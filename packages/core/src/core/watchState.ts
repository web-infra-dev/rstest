import type { RstestContext } from '../types';

/**
 * Reset the per-cycle test state at the start of a watch rerun, before either
 * executor streams events.
 *
 * The node pool and the browser host feed the same `stateManager` through the
 * shared `RunnerEventSink`, so a cycle must clear the previous one's
 * running-module/snapshot state before new events arrive — otherwise counts and
 * snapshot summaries accumulate across reruns. Core's watch cycle driver is the
 * only caller, on every trigger of every transport, which is what keeps the
 * reset from drifting per watch shape.
 */
export function prepareWatchRerunState(context: RstestContext): void {
  context.stateManager.reset();
  context.snapshotManager.clear();
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
