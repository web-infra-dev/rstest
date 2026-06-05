import type {
  Duration,
  ProjectContext,
  RstestContext,
  SourceMapInput,
  TestFileResult,
  TestResult,
} from '../types';
import type { CoverageMapData } from '../types/coverage';
import type { TraceEvent, TraceSpan } from '../utils/trace';

/**
 * The kind of executor a project runs on. Node projects run in the worker
 * pool (forks/threads); browser projects run in the `@rstest/browser` host.
 */
export type ExecutorKind = 'node' | 'browser';

/**
 * The single classifier for `browser.enabled`. Every scheduling site that needs
 * to split projects into node vs browser routes through this function instead of
 * reading `project.normalizedConfig.browser.enabled` directly, so the
 * node/browser boundary has exactly one definition.
 */
export function kindOf(project: ProjectContext): ExecutorKind {
  return project.normalizedConfig.browser.enabled ? 'browser' : 'node';
}

/**
 * Route-aware sourcemap resolver. An executor returns one so the run finalize
 * can resolve a source path back to its sourcemap without knowing which executor
 * owns the asset. `handled` lets executors be chained (browser-first, node
 * fallback) without an `if (browser)` branch: a resolver that does not own the
 * path returns `{ handled: false }` and the next resolver is consulted.
 *
 * Provider-agnostic: a bare function, never a browser type.
 */
export type ResolveSourcemap = (
  sourcePath: string,
) => Promise<{ handled: boolean; sourcemap: SourceMapInput | null }>;

/**
 * The pure data handoff an executor returns from a run. Deliberately
 * finalize-free — the run owns reporters, coverage finalize, verdict, and
 * teardown:
 *  - NO `hasFailure`: the run derives the verdict uniformly from `results` +
 *    `unhandledErrors`.
 *  - NO top-level coverage: per-file coverage rides `ExecutorRunArgs.onCoverageResult`
 *    into the one run-owned coverage map and is stripped at the executor boundary.
 *  - `duration` is reported per-executor so the run can sum across executors.
 */
export interface RunResult {
  /** Per-file results, with coverage/trace events already stripped. */
  results: TestFileResult[];
  testResults: TestResult[];
  /** Out-of-test errors (e.g. global setup failures, browser launch). */
  unhandledErrors: Error[];
  duration: Duration;
  /** Test paths that actually ran this round; feeds `filterRerunTestPaths`. */
  ranTestPaths: string[];
  /** Test paths whose files were deleted this round (watch); drops stale state. */
  deletedEntries: string[];
  resolveSourcemap?: ResolveSourcemap;
}

export interface ExecutorRunArgs {
  /** Projects of this executor's kind only. */
  projects: ProjectContext[];
  mode: 'all' | 'on-demand';
  fileFilters?: string[];
  buildStart: number;
  /** Run-owned coverage sink; the executor forwards per-file coverage here. */
  onCoverageResult?: (coverage: CoverageMapData) => void;
  /** Run-owned trace sink; the executor forwards Perfetto events here. */
  onTraceEvents?: (events: TraceEvent[]) => void;
  traceSpan: TraceSpan;
  /** Watch hint; inert until watch unifies (see RFC phase 5). */
  affectedTestFiles?: string[];
}

/**
 * The peer contract the node pool and (from phase 3) the `@rstest/browser` host
 * both implement, so the run can schedule node and browser uniformly. Modeled on
 * `createPool()`'s return object; `name` is for diagnostics.
 *
 * The collect (list) path will join this contract when the list command is
 * unified (RFC §9); for now only the run path flows through executors.
 *
 * Invariants:
 *  - `runTests` is total: a worker/page crash becomes a per-file FAIL result,
 *    never a rejection, so the run's reduce stays uniform.
 *  - `close()` is deferred teardown, always run-driven after finalize.
 */
export interface TestExecutor {
  readonly name: ExecutorKind;
  runTests(args: ExecutorRunArgs): Promise<RunResult>;
  close(): Promise<void>;
}

/** Factory mirroring `createPool()`'s construction shape. */
export interface TestExecutorFactory {
  readonly kind: ExecutorKind;
  create(args: {
    context: RstestContext;
    recommendWorkerCount?: number;
  }): Promise<TestExecutor>;
}
