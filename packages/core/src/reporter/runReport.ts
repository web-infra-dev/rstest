import type {
  Duration,
  RunReport,
  SnapshotSummary,
  TestFileResult,
  TestResult,
} from '../types';
import { collectFailures } from './utils';

export type BuildRunReportInput = {
  results: TestFileResult[];
  testResults: TestResult[];
  unhandledErrors?: Error[];
  snapshotSummary: SnapshotSummary;
  duration: Duration;
  /**
   * When `true`, a run that discovered no tests is treated as `pass`.
   * Watch mode never sets a failing exit code for empty reruns (see
   * core `reportNoTestFiles`), so watch callers should pass `true`
   * regardless of the user's `passWithNoTests` config.
   */
  passWithNoTests: boolean;
};

/**
 * Single source of truth for the post-run view of a test run.
 *
 * Derives status / counts / failures / flattened unhandled errors from raw
 * results. All reporters and the CLI exit-code logic read from the value
 * produced here, so the run-level pass/fail predicate has exactly one
 * implementation.
 */
export function buildRunReport(input: BuildRunReportInput): RunReport {
  const {
    results,
    testResults,
    unhandledErrors = [],
    snapshotSummary,
    duration,
    passWithNoTests,
  } = input;

  let failedTests = 0;
  let passedTests = 0;
  let skippedTests = 0;
  let todoTests = 0;
  for (const r of testResults) {
    if (r.status === 'fail') failedTests++;
    else if (r.status === 'pass') passedTests++;
    else if (r.status === 'skip') skippedTests++;
    else if (r.status === 'todo') todoTests++;
  }

  let failedFiles = 0;
  for (const r of results) {
    if (r.status === 'fail') failedFiles++;
  }

  const testFiles = results.length;
  const tests = testResults.length;

  const noTestsDiscovered = testFiles === 0 && tests === 0;
  const hasFailed =
    failedTests > 0 ||
    failedFiles > 0 ||
    unhandledErrors.length > 0 ||
    (noTestsDiscovered && !passWithNoTests);

  return {
    status: hasFailed ? 'fail' : 'pass',
    counts: {
      testFiles,
      failedFiles,
      tests,
      failedTests,
      passedTests,
      skippedTests,
      todoTests,
    },
    duration,
    snapshot: snapshotSummary,
    failures: collectFailures({ results, testResults }),
    unhandledErrors: unhandledErrors.map((e) => ({
      message: e.message,
      stack: e.stack,
      name: e.name,
    })),
  };
}
