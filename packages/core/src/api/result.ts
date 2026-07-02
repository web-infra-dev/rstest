/**
 * Public result types + assembly helpers shared by the programmatic
 * `RstestInstance.run()` and the `runCLI` entry. Kept separate from the engine
 * so internal reporter-state refactors don't leak into the public surface.
 */
import type {
  CoverageMapData,
  FormattedError,
  Reporter,
  RstestContext,
  SnapshotSummary,
  TestFileResult as InternalTestFileResult,
  TestResult as InternalTestResult,
  TestResultStatus,
} from '../types';

/**
 * Cross-IPC-safe error shape. Returned in `TestRunResult.unhandledErrors` and
 * in per-test `errors`/`retryErrors`. Assertion-specific fields (`diff`,
 * `actual`, `expected`) are only set for expect-style assertion errors.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  diff?: string;
  actual?: string;
  expected?: string;
  retryCount?: number;
  cause?: SerializedError;
}

/**
 * Public per-test result. Intentionally a curated subset of the internal
 * reporter type so refactors of internal reporter state do not break this
 * surface.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestResult {
  /** Final state of the test case. */
  status: TestResultStatus;
  /** Test case name (no parent suite names included). */
  name: string;
  /** Absolute path to the test file. */
  testPath: string;
  /** Names of parent `describe` blocks, outermost first. */
  parentNames?: string[];
  /** Wall-clock duration in ms; absent for skipped/todo tests. */
  duration?: number;
  /** Errors from the final attempt. */
  errors?: SerializedError[];
  /** Errors from previous failed attempts when `retry` is configured. */
  retryErrors?: SerializedError[];
  /** Number of retries performed (0 when the first attempt passed). */
  retryCount?: number;
  /** Project name from `projects` config; default project is `'default'`. */
  project: string;
}

/**
 * Public per-file result. Extends {@link TestResult} with the per-case
 * breakdown.
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestFileResult extends TestResult {
  /** Flattened list of test cases discovered in this file. */
  results: TestResult[];
}

/**
 * Result of a {@link createRstest} instance `run()` (or a `runCLI` run).
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestRunResult {
  /**
   * `stats.tests.failed === 0 && stats.files.failed === 0 &&
   * unhandledErrors.length === 0`, and additionally `false` when no test files
   * matched unless `passWithNoTests` is set (mirrors the CLI exit code).
   */
  ok: boolean;

  /** Per-file aggregate results. */
  files: TestFileResult[];

  /** Pre-computed counts. Add optional fields under `stats.*` in minor releases. */
  stats: {
    tests: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
    };
    files: {
      total: number;
      failed: number;
    };
  };

  /** Errors not attributable to a single test (worker crash, config load). */
  unhandledErrors: SerializedError[];

  /** Wall-clock duration in ms. Sub-phase fields may be added under `duration.*`. */
  duration: { total: number };

  /** Snapshot summary. Absent only when the run aborted before any test executed (e.g. config load error). */
  snapshot?: SnapshotSummary;

  /** Coverage data. Only present when `coverage.enabled` in the resolved config. */
  coverage?: CoverageMapData;
}

export const toSerializedError = (
  err: unknown,
  seen: WeakSet<object> = new WeakSet(),
): SerializedError => {
  if (!err || typeof err !== 'object') {
    return { name: 'Error', message: String(err) };
  }
  if (seen.has(err)) {
    return { name: 'Error', message: '[Circular]' };
  }
  seen.add(err);
  const e = err as Partial<FormattedError> & { cause?: unknown };
  return {
    name: e.name || 'Error',
    message: e.message ?? String(err),
    stack: e.stack,
    diff: e.diff,
    actual: e.actual,
    expected: e.expected,
    retryCount: e.retryCount,
    cause: e.cause !== undefined ? toSerializedError(e.cause, seen) : undefined,
  };
};

const toPublicTestResult = (r: InternalTestResult): TestResult => ({
  status: r.status,
  name: r.name,
  testPath: r.testPath,
  parentNames: r.parentNames,
  duration: r.duration,
  errors: r.errors?.map((err) => toSerializedError(err)),
  retryErrors: r.retryErrors?.map((err) => toSerializedError(err)),
  retryCount: r.retryCount,
  project: r.project,
});

export const toPublicTestFileResult = (
  f: InternalTestFileResult,
): TestFileResult => ({
  ...toPublicTestResult(f),
  results: f.results.map(toPublicTestResult),
});

const computeStats = (
  files: readonly TestFileResult[],
): TestRunResult['stats'] => {
  const stats: TestRunResult['stats'] = {
    tests: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
    files: { total: files.length, failed: 0 },
  };
  for (const file of files) {
    if (file.status === 'fail') {
      stats.files.failed++;
    }
    for (const t of file.results) {
      stats.tests.total++;
      switch (t.status) {
        case 'pass':
          stats.tests.passed++;
          break;
        case 'fail':
          stats.tests.failed++;
          break;
        case 'skip':
          stats.tests.skipped++;
          break;
        case 'todo':
          stats.tests.todo++;
          break;
      }
    }
  }
  return stats;
};

/** Mutable bag a {@link createCaptureReporter} reporter fills during a run. */
type CapturedRunState = {
  unhandledErrors: SerializedError[];
  duration: { total: number };
  coverage?: CoverageMapData;
  snapshot?: SnapshotSummary;
  /**
   * `process.exitCode` observed at the end of the run, before the host-safe
   * guard restores it. Captures failures that only surface as a non-zero exit
   * code (coverage thresholds/report generation, global teardown) — the CLI
   * fails on these, so `ok` must too.
   */
  exitCode?: number | string;
};

export const createCapturedRunState = (): CapturedRunState => ({
  unhandledErrors: [],
  duration: { total: 0 },
});

/** Record a run's `onTestRunEnd` summary into `captured` (errors mapped to the
 * serializable shape). `exitCode` is filled separately by the run caller. */
const fillCapturedFromRunEnd = (
  captured: CapturedRunState,
  {
    unhandledErrors,
    duration,
    coverage,
    snapshotSummary,
  }: Parameters<NonNullable<Reporter['onTestRunEnd']>>[0],
): void => {
  captured.unhandledErrors = (unhandledErrors ?? []).map((err) =>
    toSerializedError(err),
  );
  captured.duration = { total: duration.totalTime };
  captured.coverage = coverage;
  captured.snapshot = snapshotSummary;
};

/**
 * A reporter that records the run-level summary (errors, duration, coverage,
 * snapshot) into `captured`. Added to a run's reporter list so a structured
 * {@link TestRunResult} can be assembled without parsing reporter output.
 */
export const createCaptureReporter = (
  captured: CapturedRunState,
): Reporter => ({
  onTestRunEnd: (args) => fillCapturedFromRunEnd(captured, args),
});

/**
 * A reporter that assembles the public {@link TestRunResult} at the end of each
 * run and hands it to `onResult`. Used by the programmatic watch session so a
 * caller receives structured results on every rerun without implementing a
 * reporter. `context` is the (session-stable) runner context, used for `ok`'s
 * no-tests / `passWithNoTests` derivation. A throwing `onResult` is isolated so
 * a caller callback can't tear down the watch session. Exit-code-only failures
 * (coverage thresholds, teardown) are not folded into `ok` here — watch has no
 * post-run point to observe `process.exitCode` per rerun — but test/file
 * failures and `unhandledErrors` are.
 */
export const createResultReporter = (
  onResult: (result: TestRunResult) => void,
  context: RstestContext | undefined,
): Reporter => ({
  onTestRunEnd: (args) => {
    const captured = createCapturedRunState();
    fillCapturedFromRunEnd(captured, args);
    const files = args.results.map(toPublicTestFileResult);
    const result = assembleTestRunResult(files, captured, context);
    try {
      onResult(result);
    } catch {
      // A caller callback error must not tear down the watch session.
    }
  },
});

/**
 * Assemble the final {@link TestRunResult} from collected per-file results and
 * the captured run summary. `context` is the run's context (or `undefined` when
 * the run aborted before a context existed, e.g. a config load error).
 */
export const assembleTestRunResult = (
  files: TestFileResult[],
  captured: CapturedRunState,
  context: RstestContext | undefined,
): TestRunResult => {
  const stats = computeStats(files);

  // Mirror the CLI: discovering no test files is a failure unless
  // `passWithNoTests` is set. `process.exitCode` is restored by the caller's
  // guards, so `ok` must derive this independently rather than reading it.
  const noTestsFailure =
    !!context &&
    files.length === 0 &&
    !context.normalizedConfig.passWithNoTests;

  const ok =
    stats.tests.failed === 0 &&
    stats.files.failed === 0 &&
    captured.unhandledErrors.length === 0 &&
    !noTestsFailure &&
    // Exit-code-only failures (coverage thresholds/report generation, global
    // teardown) never touch the stats above, so fold in the run's final
    // `process.exitCode` to mirror the CLI's pass/fail.
    !captured.exitCode;

  return {
    ok,
    files,
    stats,
    unhandledErrors: captured.unhandledErrors,
    duration: captured.duration,
    snapshot: captured.snapshot,
    coverage: captured.coverage,
  };
};
