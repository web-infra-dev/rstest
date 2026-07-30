import {
  type BrowserTestExecutor,
  type BrowserTestRunResult,
  buildBrowserCoverageMap,
  color,
  type CreateBrowserExecutorOptions,
  type ExecutorCycleOutcome,
  type ExecutorInvalidationCallback,
  type ExecutorRunCycleOptions,
  type ListCommandResult,
  logger,
  type RstestContext,
  type TestFileResult,
} from '@rstest/core/internal/browser';
import {
  type BrowserWatchSession,
  cleanupWatchRuntime,
  listBrowserTests,
  runBrowserController,
} from './hostController';

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
 * host's `BrowserTestRunResult` into the shared `ExecutorCycleOutcome`.
 *
 * Watch and non-watch differ only in what one `runCycle` means. Non-watch: one
 * `runBrowserController` invocation that returns a deferred `close`. Watch: the
 * first cycle boots the persistent runtime and hands back a live
 * {@link BrowserWatchSession}; every cycle after it is a rerun the host's own
 * triggers signalled through `onInvalidate` and core scheduled. Either way core
 * finalizes, so this adapter never touches reporters or the exit code.
 */
export async function createBrowserExecutor(
  context: RstestContext,
  options: CreateBrowserExecutorOptions,
): Promise<BrowserTestExecutor> {
  const {
    projects,
    coverageProvider,
    shardedEntries,
    freezeShardedEntries,
    filesOnly,
    allowEmptyRun,
    appliedModifyRstestConfigEnvironments,
  } = options;
  const isWatchMode = context.command === 'watch';
  let deferredClose: (() => Promise<void>) | undefined;
  // The host has no mid-launch abort, so `close()` must wait for an in-flight
  // cycle to settle before it can tear down — otherwise a close racing the
  // cycle (e.g. the signal-driven cleanup path) sees no `deferredClose` yet
  // and leaks the launching browser + servers.
  let inFlightCycle: Promise<unknown> | undefined;
  // Registered before the first cycle: booting the runtime installs the watch
  // triggers, and the first rebuild can signal as soon as it does.
  let invalidationCallback: ExecutorInvalidationCallback | undefined;
  let watchSession: BrowserWatchSession | undefined;

  // Merge the host's per-file `result.coverage` into one map (shared core
  // helper, stripping it from each result to avoid reporter/state cache
  // bloat), then hand the shared finalize a coverage `map` (no `raw` — browser
  // coverage is istanbul-only).
  const foldOutcome = (
    result: BrowserTestRunResult | void,
  ): ExecutorCycleOutcome => {
    if (!result) {
      return emptyOutcome();
    }
    const map = buildBrowserCoverageMap(
      result.results as TestFileResult[],
      coverageProvider,
    );
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
      // holds structurally for both executors, and so browser-side work that
      // must precede the first cycle has somewhere to go.
    },
    async runCycle(
      opts: ExecutorRunCycleOptions,
    ): Promise<ExecutorCycleOutcome> {
      if (watchSession) {
        // A watch rerun: the host's trigger already resolved the scope and
        // handed it over as the invalidation hint, which core passes back here.
        //
        // `opts.updateSnapshot` is dropped, and that is a gap rather than a
        // choice. Core resolves it per trigger so a cycle no `u` selected files
        // for cannot rewrite their snapshots; the host instead re-reads the live
        // `snapshotManager` flag for every page it loads, so a browser cycle
        // queued inside the `u` hold window still runs under `'all'`. Closing it
        // means plumbing this option through `watchSession.runCycle` to the
        // per-page config, which is also what would make the seam doc on
        // `ExecutorRunCycleOptions.updateSnapshot` true on this side.
        const cycle = watchSession.runCycle(opts.fileFilters ?? []);
        inFlightCycle = cycle;
        try {
          return await cycle;
        } finally {
          inFlightCycle = undefined;
        }
      }

      const cycle = runBrowserController(context, {
        projects,
        shardedEntries,
        freezeShardedEntries,
        allowEmptyRun,
        appliedModifyRstestConfigEnvironments,
        onTraceEvents: opts.onTraceEvents,
        env: opts.env,
        updateSnapshot: opts.updateSnapshot,
        onInvalidate: isWatchMode
          ? (hint) => invalidationCallback?.(hint)
          : undefined,
      });
      inFlightCycle = cycle;
      try {
        const result = await cycle;
        // Non-watch runs return a deferred `close`; collapse teardown into the
        // shared `executors.close()` exit path.
        deferredClose = result?.close;
        watchSession = result?.watchSession;
        return foldOutcome(result);
      } finally {
        inFlightCycle = undefined;
      }
    },
    onInvalidate(cb: ExecutorInvalidationCallback): void {
      invalidationCallback = cb;
    },
    hasWatchSession(): boolean {
      return watchSession !== undefined;
    },
    async requestRerun(testPaths?: string[]): Promise<void> {
      if (!watchSession) {
        // Core gates rerun keys until every executor is past its first cycle, so
        // reaching here means no session will ever open: the launch found no test
        // files or failed outright, and reported that itself. The keys stay
        // installed either way — a mixed run's node side keeps watching, and even
        // a browser-only run outlives a launch that opened nothing — so resolving
        // in silence would let the shortcut claim a rerun that never happened.
        logger.log(
          color.yellow(
            '\nBrowser Mode has no live watch session, so this rerun skipped it.',
          ),
        );
        return;
      }
      await watchSession.requestRerun(testPaths);
    },
    async collect(opts): Promise<{ list: ListCommandResult[] }> {
      const pending = listBrowserTests(context, {
        projects,
        shardedEntries,
        freezeShardedEntries,
        filesOnly,
        appliedModifyRstestConfigEnvironments,
        env: opts.env,
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
      if (isWatchMode) {
        // The watch runtime spans every cycle, so it is not a per-cycle
        // deferred close — the executor is its owner.
        watchSession = undefined;
        await cleanupWatchRuntime();
        return;
      }
      const close = deferredClose;
      deferredClose = undefined;
      await close?.();
    },
  };
}
