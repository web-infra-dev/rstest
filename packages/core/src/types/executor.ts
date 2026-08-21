import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { TraceEvent } from '../utils/trace';
import type { ListCommandResult, ProjectContext } from './core';
import type { CoverageMapData, RawCoverageResolveOptions } from './coverage';
import type { SourceMapInput } from './reporter';
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
   * Watch only: whether this cycle was queued by the executor's own invalidation
   * signal rather than by a CLI shortcut or the session's initial trigger. It is
   * how a transport recognizes the cycle its last signal asked for among the
   * cycles core hands it — the node side publishes a finished rebuild's measured
   * duration when the compile ends and lets only that cycle claim it, so a
   * shortcut rerun dispatched from the queue in between reports its own build
   * span instead of the rebuild's.
   */
  fromInvalidation?: boolean;
  /**
   * Per cycle, never captured at executor construction, so a watch `u` (update
   * snapshot) rerun is honored. Core resolves it when the trigger queues its
   * cycle rather than when the cycle is dispatched: `u` also flips the live
   * `snapshotManager` flag, for the browser host's per-page reads, and a cycle
   * queued inside that window by anything else must not rewrite the snapshots of
   * files no `u` selected.
   *
   * That last guarantee reaches as far as an executor honors this field. The
   * node pool does. The browser host reads the live flag per page load instead
   * and its executor drops this option on a watch rerun, so a browser cycle
   * queued inside the `u` window still runs under `'all'` — a gap to close by
   * plumbing the option through the browser watch session, not a stance.
   */
  updateSnapshot: SnapshotUpdateState;
  /**
   * Post-globalSetup env change-set produced by the core-owned pre-cycle
   * globalSetup stage (browser projects' setups only). The node executor reads
   * the same context-local overlay directly; the browser executor merges this
   * change-set into the per-run env store between the static base
   * (`NODE_ENV`/`RSTEST`) and the user `test.env` config.
   */
  env?: Record<string, string | undefined>;
  onTraceEvents?: (events: TraceEvent[]) => void;
}

/**
 * Watch invalidation subscriber. The hint carries only what the transport knows
 * for free at signal time: `isFirstBuild` marks the session's initial build,
 * which core runs as a full cycle rather than an on-demand one, and
 * `fileFilters` carries the scope when the trigger already resolved it (the
 * browser host plans its rerun set before signalling, so that resolution is not
 * repeated — and never doubled — inside `runCycle`).
 *
 * The returned promise settles when the queued cycle has finalized. It is there
 * for a trigger that must wait for its own cycle, never as back-pressure: what
 * keeps two cycles from overlapping on the shared `stateManager` is core's
 * queue.
 *
 * Waiting on it from inside a bundler's compile hook costs a blind window: the
 * bundler keeps no file watcher attached while that hook is pending and
 * re-attaches by re-checking what it already knew about, so a test file created
 * or deleted in that window is never noticed at all — and under the queue the
 * window can stretch across another executor's cycle. The browser transport
 * therefore signals and returns. The node transport still waits, because its
 * cycle pulls the affected-entry diff from the dev server and that pull
 * advances the baseline it diffs against: a compile's changes are consumable
 * exactly once, and holding the hook is what keeps a second compile from landing
 * against the same baseline before the first one's changes are consumed. That is
 * a tracked gap, not a stance, and the shape
 * that closes it is the one the browser side already uses — resolve the scope
 * synchronously inside the hook and hand it over as `fileFilters`, then signal
 * and return. The doubling warned about above is diffing at hook time *and*
 * again inside `runCycle`, not a single hook-time snapshot the cycle consumes.
 */
export type ExecutorInvalidationCallback = (hint: {
  isFirstBuild: boolean;
  fileFilters?: string[];
}) => void | Promise<void>;

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
  /**
   * Test paths deleted during this cycle (watch only). `finalizeRunCycle`
   * prunes reporter state with these. The node executor fills them from the
   * dev-compile stats diff; the browser host's watch file-set diff prunes
   * reporter state directly today, so its outcomes omit them.
   */
  deletedTestPaths?: string[];
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
    loadAssetFiles?: RawCoverageResolveOptions['loadAssetFiles'];
    loadSourceMaps?: RawCoverageResolveOptions['loadSourceMaps'];
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
 *
 * An optional member here says "not every runtime has this capability", and
 * every consumer re-requires it through a narrowed type (`BrowserTestExecutor`,
 * `NodeExecutor`) before calling — none of them optional-chains. So optional is
 * not the place for an obligation core must *perform* in a fixed order: the node
 * side's `ensureRunResources` stays off this interface, where dropping it is a
 * build error at the two call sites that order it against the browser launch.
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
  /**
   * List tests without running them. Optional because only the browser executor
   * implements it today (`rstest list` collects browser tests through it); the
   * node list collect still lives in `listTests.ts` — it consumes the planner's
   * plan and node build, but has not converged onto this seam member yet.
   */
  collect?(
    options: Pick<ExecutorRunCycleOptions, 'env' | 'fileFilters'>,
  ): Promise<{ list: ListCommandResult[] }>;
  close(): Promise<void>;
  /**
   * Subscribe to this executor's watch trigger; the callback runs one watch
   * cycle (core resets the cycle-scoped state, calls `runCycle`, and finalizes).
   * Every rerun trigger a transport owns — dev rebuild, HMR, an in-page rerun
   * button — routes through this one subscriber, so no executor ever drives a
   * cycle of its own.
   *
   * Core serializes cycles behind a queue, so two watch cycles never overlap on
   * the shared `stateManager` — the transport is free to signal and move on,
   * and should when it signals from a hook its own file watcher waits on (see
   * {@link ExecutorInvalidationCallback}).
   *
   * A trigger that resolves to no work must not fire the callback — a cycle that
   * runs nothing still reports "no test files need re-run", which is not what a
   * scope that simply misses this executor's files should print.
   */
  onInvalidate?(cb: ExecutorInvalidationCallback): void;
  /**
   * Watch only: ask this executor to schedule a cycle over `testPaths` (all of
   * its test files when omitted), the way a CLI shortcut does. Implemented by
   * the transports whose rerun scope core cannot express as a plain
   * `runCycle({ fileFilters })` — the browser host has to reconcile the request
   * against its own file-set diff first. It resolves once the resulting cycle
   * (if any) has completed, so a caller may restore state it toggled for it.
   *
   * A transport left with nothing to schedule on must say so rather than resolve
   * in silence, as though the rerun happened. Core gates rerun keys until every
   * executor has *settled* its first cycle, not succeeded at it, so arriving here
   * without a session means that startup opened none — and the keys are still
   * installed either way, because the run outlives it: a mixed run's other side
   * keeps watching, and even a single-executor run stays up on the CLI's
   * config-restart watcher.
   */
  requestRerun?(testPaths?: string[]): Promise<void>;
}
