import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { TraceEvent } from '../utils/trace';
import type { ListCommandResult, ProjectContext } from './core';
import type { CoverageMapData } from './coverage';
import type { TestFileResult, TestResult } from './testSuite';

/**
 * Options for a single {@link TestExecutor.runCycle}. Core owns cycle
 * sequencing: it produces one of these per cycle and hands the same shape to
 * every executor, so node-only, browser-only, and mixed runs share one loop.
 */
export interface ExecutorRunCycleOptions {
  /**
   * Per-compile id, bumped every cycle (initial build + each watch rebuild).
   * The node pool flushes its kept worker cache on a `buildId` boundary; the
   * browser host uses it for run-token staleness.
   */
  buildId: number;
  mode: 'all' | 'on-demand';
  fileFilters?: string[];
  /**
   * Read live per cycle from `context.snapshotManager.options`, never captured
   * at executor construction, so a watch `u` (update snapshot) rerun is honored.
   */
  updateSnapshot: SnapshotUpdateState;
  /**
   * Post-globalSetup env snapshot, produced by the core-owned pre-cycle stage.
   * Not populated yet: the node pool re-reads `process.env` at dispatch today;
   * Phase 5 fills this so the browser host can inject it into its per-run env
   * store (globalSetup env propagation).
   */
  env?: Record<string, string | undefined>;
  /** Pre-resolved sharded entries per project (key: `environmentName`). */
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
  onTraceEvents?: (events: TraceEvent[]) => void;
  /**
   * Cycle build-start timestamp. In watch this is the rebuild start (from the
   * dev-compile hook) so the reported build time spans the rebuild; defaults to
   * the executor picking `Date.now()` at cycle start otherwise.
   */
  buildStart?: number;
}

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

/**
 * The outer-seam contract shared by the node pool (`NodeExecutor`) and the
 * browser host (`BrowserExecutor`): turn compiled test files into runner-event
 * streams and a cycle outcome. Everything upstream of the build (config →
 * projects → plan) and downstream of runner events (`finalizeRunCycle`) is one
 * core implementation; only what the two runtimes genuinely fork — transport,
 * module loading, isolation unit, scheduling, provider management — lives behind
 * this interface.
 */
export interface TestExecutor {
  /** `'node' | 'browser'`. */
  readonly name: string;
  /**
   * The explicit project subset this executor was constructed with (plan
   * output), not re-derived from `context` — `context.projects` is mutated
   * during planning, so a construction-time capture is the stable source.
   */
  readonly projects: ProjectContext[];
  init(): Promise<void>;
  runCycle(options: ExecutorRunCycleOptions): Promise<ExecutorCycleOutcome>;
  collect(
    options: Pick<ExecutorRunCycleOptions, 'fileFilters' | 'shardedEntries'> & {
      /**
       * Shared per-executor collect timeout. The node pool passes `undefined`
       * (no timeout, its current behavior); the browser host defaults to
       * `30_000` (its current watchdog). One knob, per-executor default.
       */
      timeoutMs?: number;
    },
  ): Promise<{ list: ListCommandResult[] }>;
  close(): Promise<void>;
  /**
   * Watch (Phase 6). Signal-only: the callback tells core "something changed";
   * affected-entry resolution happens inside `runCycle({ mode: 'on-demand' })`,
   * because node resolves affected entries by pull at cycle time and doing it in
   * the hook would consume the diff baseline (double-diff hazard). The optional
   * hint carries only what the transport already knows for free; core treats it
   * as advisory.
   */
  onInvalidate?(
    cb: (hint?: {
      affectedTestPaths?: string[];
      deletedTestPaths?: string[];
    }) => void,
  ): void;
}
