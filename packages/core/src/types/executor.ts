import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { CoverageMapData } from './coverage';
import type { TestFileResult, TestResult } from './testSuite';

/**
 * The result one executor (node pool or browser host) produces for a single run
 * cycle. `finalizeRunCycle` reduces an array of these — one per executor — into
 * the run verdict, so node-only, browser-only, and mixed runs share one
 * finalize implementation.
 */
export interface ExecutorCycleOutcome {
  results: TestFileResult[];
  testResults: TestResult[];
  /** Launch/setup failures surfaced outside any test (e.g. browser launch). */
  errors: Error[];
  /**
   * Test paths this executor ran this cycle. `finalizeRunCycle` builds the
   * watch-mode `filterRerunTestPaths` from every outcome's paths so the
   * failing-test summary never silently omits an executor's failures.
   */
  testPaths: string[];
  duration: { buildTime: number; testTime: number };
  /**
   * Coverage this executor produced this cycle. `finalizeRunCycle` merges every
   * outcome's `map` into the run's coverage map, then resolves every `raw`
   * batch through the provider. The node pool carries `map` (its istanbul
   * per-file merge) and `raw` (accumulated v8 raw results); the browser host
   * carries `map` (its per-file merge) and no `raw`.
   */
  coverage?: {
    map?: CoverageMapData;
    raw?: unknown[];
  };
  /**
   * Route-aware source map resolver. `finalizeRunCycle` tries each outcome's
   * resolver in order and falls through to `null` when none handles the path.
   */
  resolveSourcemap?: (
    sourcePath: string,
  ) => Promise<{ handled: boolean; sourcemap: SourceMapInput | null }>;
}
