import type {
  ExecutorRunArgs,
  RunResult,
  TestExecutor,
  TestExecutorFactory,
} from '@rstest/core/internal/browser';
import { runBrowserController } from './hostController';

const EMPTY_DURATION = { totalTime: 0, buildTime: 0, testTime: 0 } as const;

const emptyRunResult = (): RunResult => ({
  results: [],
  testResults: [],
  unhandledErrors: [],
  duration: { ...EMPTY_DURATION },
  ranTestPaths: [],
  deletedEntries: [],
});

/**
 * Thin adapter that exposes the browser host as a {@link TestExecutor} peer of
 * the node worker pool, so the non-watch browser-only run flows through the same
 * core `run()` finalize (reporters, the one coverage map, verdict, teardown).
 *
 * It wraps {@link runBrowserController} in `skipOnTestRunEnd` mode — the host
 * fans the per-test lifecycle hooks into `context.reporters`/`stateManager` and
 * streams `process.exitCode` as before, but does NOT self-finalize; the core run
 * owns `onTestRunStart`/`onTestRunEnd`, coverage report generation, and the
 * deferred `close()`. The `BrowserTestRunResult` is re-shaped at the seam:
 *  - per-file coverage is forwarded via `onCoverageResult` and stripped from the
 *    results (mirrors the node pool's `delete result.coverage`);
 *  - `hasFailure` is dropped — the run derives the verdict from
 *    `results`/`unhandledErrors`;
 *  - `resolveSourcemap` crosses as a provider-agnostic bare function.
 */
export const createBrowserExecutorFactory = (): TestExecutorFactory => ({
  kind: 'browser',
  async create({ context }) {
    // Captured from the run's `BrowserTestRunResult.close`; the core run invokes
    // `close()` in its finally after reporter + coverage finalize.
    let pendingClose: (() => Promise<void>) | undefined;

    const runTests = async (args: ExecutorRunArgs): Promise<RunResult> => {
      const { onCoverageResult, onTraceEvents } = args;

      // Related mode resolved to zero affected files: the run is empty by
      // construction. Return empty without launching the browser runtime —
      // otherwise the host would collect and run the full suite, ignoring the
      // related filter (the node executor sees `{}` entries here and is empty
      // for the same reason).
      if (context.relatedResolutionEmpty) {
        return emptyRunResult();
      }

      const browserResult = await runBrowserController(context, {
        skipOnTestRunEnd: true,
        onTraceEvents,
      });

      // The host returns void when it discovered no test files (it has already
      // set `process.exitCode`; the "no test files" message is suppressed by
      // `skipOnTestRunEnd` and printed once by core's `noTestsDiscovered`
      // branch).
      if (!browserResult) {
        return emptyRunResult();
      }

      pendingClose = browserResult.close;

      // Drain per-file coverage into the run-owned merged map and strip it from
      // the results so the single core coverage map is browser coverage's only
      // home (mirrors the node pool layer's `delete result.coverage`).
      for (const result of browserResult.results) {
        if (result.coverage) {
          onCoverageResult?.(result.coverage);
          delete result.coverage;
        }
      }

      return {
        results: browserResult.results,
        testResults: browserResult.testResults,
        unhandledErrors: browserResult.unhandledErrors ?? [],
        duration: browserResult.duration,
        // Non-watch browser-only runs the whole set; the ran paths are exactly
        // the result paths, matching node's `filterRerunTestPaths` contribution.
        ranTestPaths: browserResult.results.map((result) => result.testPath),
        deletedEntries: [],
        resolveSourcemap: browserResult.resolveSourcemap,
      };
    };

    return {
      name: 'browser',
      runTests,
      async close() {
        await pendingClose?.();
      },
    } satisfies TestExecutor;
  },
});
