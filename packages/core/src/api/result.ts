/**
 * Public result types + assembly helpers shared by the programmatic
 * `RstestInstance.run()` and the `runCli` entry. Kept separate from the engine
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
 * `actual`, `expected`) are only set for `@vitest/expect`-style errors.
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
 * Result of a {@link createRstest} instance `run()` (or a `runCli` run).
 *
 * @experimental Subject to change until 1.0.0.
 */
export interface TestRunResult {
  /** `stats.tests.failed === 0 && stats.files.failed === 0 && unhandledErrors.length === 0`. */
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

export const computeStats = (
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
export type CapturedRunState = {
  unhandledErrors: SerializedError[];
  duration: { total: number };
  coverage?: CoverageMapData;
  snapshot?: SnapshotSummary;
};

export const createCapturedRunState = (): CapturedRunState => ({
  unhandledErrors: [],
  duration: { total: 0 },
});

/**
 * A reporter that records the run-level summary (errors, duration, coverage,
 * snapshot) into `captured`. Added to a run's reporter list so a structured
 * {@link TestRunResult} can be assembled without parsing reporter output.
 */
export const createCaptureReporter = (
  captured: CapturedRunState,
): Reporter => ({
  onTestRunEnd: ({ unhandledErrors, duration, coverage, snapshotSummary }) => {
    captured.unhandledErrors = (unhandledErrors ?? []).map((err) =>
      toSerializedError(err),
    );
    captured.duration = { total: duration.totalTime };
    captured.coverage = coverage;
    captured.snapshot = snapshotSummary;
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
    !noTestsFailure;

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
