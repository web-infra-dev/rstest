import type { RstestContext } from '../types';

/**
 * Reset the per-cycle test state at the start of a watch rerun, before either
 * executor streams events.
 *
 * The node pool and the browser host now feed the same `stateManager` through
 * the shared `RunnerEventSink`, so a rerun must clear the previous cycle's
 * running-module/snapshot state before new events arrive — otherwise counts and
 * snapshot summaries accumulate across reruns. Both watch paths (the node
 * rebuild reruns in `runTests` and the browser host's rerun scheduler) call this
 * single helper so the reset can never drift between the two implementations.
 */
export function prepareWatchRerunState(context: RstestContext): void {
  context.stateManager.reset();
  context.snapshotManager.clear();
}
