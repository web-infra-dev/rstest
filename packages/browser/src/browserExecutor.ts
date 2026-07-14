import type {
  BrowserTestRunResult,
  CreateBrowserExecutorOptions,
  ExecutorCycleOutcome,
  ExecutorRunCycleOptions,
  ListCommandResult,
  RstestContext,
  TestExecutor,
  TestFileResult,
} from '@rstest/core/internal/browser';
import { listBrowserTests, runBrowserController } from './hostController';

const emptyOutcome = (): ExecutorCycleOutcome => ({
  results: [],
  testResults: [],
  errors: [],
  testPaths: [],
  duration: { buildTime: 0, testTime: 0 },
});

/**
 * The browser side of the {@link TestExecutor} seam. It delegates into the
 * existing `hostController` in place (no file split this phase) and adapts the
 * host's `BrowserTestRunResult` into the shared `ExecutorCycleOutcome` — the
 * former `toBrowserOutcome` core adapter is folded in here and deleted.
 *
 * Only used in non-watch runs (the shared executor loop); browser watch stays
 * host-driven and self-finalizing until Phase 6, so `runCycle` maps directly
 * onto one `runBrowserController` invocation and its coverage/close semantics.
 */
export async function createBrowserExecutor(
  context: RstestContext,
  options: CreateBrowserExecutorOptions,
): Promise<TestExecutor> {
  const {
    projects,
    coverageProvider,
    freezeShardedEntries,
    filesOnly,
    allowEmptyRun,
    appliedModifyRstestConfigEnvironments,
  } = options;
  let deferredClose: (() => Promise<void>) | undefined;
  // The host has no mid-launch abort, so `close()` must wait for an in-flight
  // cycle to settle before it can tear down — otherwise a close racing the
  // cycle (e.g. the shared executor loop failing fast on the node side) sees
  // no `deferredClose` yet and leaks the launching browser + servers.
  let inFlightCycle: Promise<unknown> | undefined;

  // Merge the host's per-file `result.coverage` into one map, stripping it from
  // each result to avoid reporter/state cache bloat, then hand the shared
  // finalize a coverage `map` (no `raw` — browser coverage is istanbul-only).
  const foldOutcome = (
    result: BrowserTestRunResult | void,
  ): ExecutorCycleOutcome => {
    if (!result) {
      return emptyOutcome();
    }
    const map = coverageProvider?.createCoverageMap();
    for (const fileResult of result.results as TestFileResult[]) {
      if (fileResult.coverage) {
        map?.merge(fileResult.coverage);
        delete fileResult.coverage;
      }
    }
    return {
      results: result.results,
      testResults: result.testResults,
      errors: result.unhandledErrors ?? [],
      testPaths: result.results.map((r) => r.testPath),
      duration: {
        buildTime: result.duration.buildTime,
        testTime: result.duration.testTime,
      },
      coverage: { map: map?.toJSON() },
      resolveSourcemap: result.resolveSourcemap,
    };
  };

  return {
    name: 'browser',
    projects,
    async init(): Promise<void> {
      // Server/provider launch stays inside `runBrowserController` (delegate in
      // place). Kept as an explicit hook so the plan → init → runCycle barrier
      // is honored structurally and Phase 5 can attach browser-side hook
      // application here.
    },
    async runCycle(
      opts: ExecutorRunCycleOptions,
    ): Promise<ExecutorCycleOutcome> {
      const cycle = runBrowserController(context, {
        projects,
        shardedEntries: opts.shardedEntries,
        freezeShardedEntries,
        allowEmptyRun,
        appliedModifyRstestConfigEnvironments,
        onTraceEvents: opts.onTraceEvents,
      });
      inFlightCycle = cycle;
      try {
        const result = await cycle;
        // Non-watch runs return a deferred `close`; collapse teardown into the
        // shared `executors.close()` exit path.
        deferredClose = result?.close;
        return foldOutcome(result);
      } finally {
        inFlightCycle = undefined;
      }
    },
    async collect(opts): Promise<{ list: ListCommandResult[] }> {
      const pending = listBrowserTests(context, {
        projects,
        shardedEntries: opts.shardedEntries,
        freezeShardedEntries,
        filesOnly,
        appliedModifyRstestConfigEnvironments,
        timeoutMs: opts.timeoutMs,
      });
      inFlightCycle = pending;
      try {
        const { list, close } = await pending;
        deferredClose = close;
        return { list };
      } finally {
        inFlightCycle = undefined;
      }
    },
    async close(): Promise<void> {
      if (inFlightCycle) {
        // A rejected cycle cleans up host-side; settling is all that's needed.
        await inFlightCycle.catch(() => undefined);
      }
      const close = deferredClose;
      deferredClose = undefined;
      await close?.();
    },
  };
}
