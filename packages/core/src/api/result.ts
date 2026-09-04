import type {
  CoverageMapData,
  FormattedError,
  InternalContext,
  Reporter,
  SnapshotSummary,
  TestFileResult as InternalTestFileResult,
  TestResult as InternalTestResult,
} from '../types';
import type {
  SerializedError,
  TestCaseResult,
  TestFileRunResult,
  TestRunResult,
  TestRunStatus,
} from './types';

export const toSerializedError = (
  error: unknown,
  seen: WeakSet<object> = new WeakSet(),
): SerializedError => {
  if (!error || typeof error !== 'object') {
    return { name: 'Error', message: String(error) };
  }
  if (seen.has(error)) {
    return { name: 'Error', message: '[Circular]' };
  }
  seen.add(error);
  const value = error as Partial<FormattedError>;
  return {
    name: value.name || 'Error',
    message: value.message ?? String(error),
    stack: value.stack,
    diff: value.diff,
    actual: value.actual,
    expected: value.expected,
    retryCount: value.retryCount,
    cause:
      value.cause === undefined
        ? undefined
        : toSerializedError(value.cause, seen),
  };
};

export const toPublicTestCaseResult = (
  result: InternalTestResult,
): TestCaseResult => ({
  status: result.status,
  name: result.name,
  testPath: result.testPath,
  parentNames: result.parentNames,
  duration: result.duration,
  errors: result.errors?.map((error) => toSerializedError(error)),
  retryErrors: result.retryErrors?.map((error) => toSerializedError(error)),
  retryCount: result.retryCount,
  project: result.project,
  meta: result.meta,
});

export const toPublicTestFileRunResult = (
  result: InternalTestFileResult,
): TestFileRunResult => ({
  ...toPublicTestCaseResult(result),
  tests: result.results.map(toPublicTestCaseResult),
});

const testStatusSummaryKeys = {
  pass: 'passed',
  fail: 'failed',
  skip: 'skipped',
  todo: 'todo',
} satisfies Record<
  TestCaseResult['status'],
  Exclude<keyof TestRunResult['summary']['tests'], 'total'>
>;

export const computeSummary = (
  files: readonly TestFileRunResult[],
): TestRunResult['summary'] => {
  const summary: TestRunResult['summary'] = {
    tests: { total: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
    files: { total: files.length, failed: 0 },
  };

  for (const file of files) {
    if (file.status === 'fail') {
      summary.files.failed++;
    }
    for (const test of file.tests) {
      summary.tests.total++;
      summary.tests[testStatusSummaryKeys[test.status]]++;
    }
  }

  return summary;
};

type CapturedCycle = {
  files: TestFileRunResult[];
  unhandledErrors: SerializedError[];
  duration: { total: number };
  snapshot: SnapshotSummary;
  coverage?: CoverageMapData;
};

const getStatus = (
  context: InternalContext,
  captured: CapturedCycle,
): TestRunStatus => {
  if (captured.unhandledErrors.length > 0) {
    return 'error';
  }
  if (context.exitCode.current !== 0) {
    return 'fail';
  }
  return 'pass';
};

const createResult = (
  context: InternalContext,
  captured: CapturedCycle,
): TestRunResult => {
  return {
    status: getStatus(context, captured),
    files: captured.files,
    summary: computeSummary(captured.files),
    unhandledErrors: captured.unhandledErrors,
    duration: captured.duration,
    snapshot: captured.snapshot,
    coverage: captured.coverage,
  };
};

export type ResultReporter = {
  reporter: Reporter;
  nextResult(): Promise<TestRunResult>;
  errorResult(error: unknown): TestRunResult;
};

export function createResultReporter(
  context: InternalContext,
  { onResult }: { onResult?: (result: TestRunResult) => void } = {},
): ResultReporter {
  let cycleFiles: TestFileRunResult[] = [];
  let captured: CapturedCycle | undefined;
  let resolveResult: ((result: TestRunResult) => void) | undefined;

  const removeCycleEndListener = context.exitCode.onCycleEnd(() => {
    if (!captured) {
      return;
    }
    const result = createResult(context, captured);
    captured = undefined;
    resolveResult?.(result);
    resolveResult = undefined;
    if (onResult) {
      try {
        Promise.resolve(onResult(result)).catch(() => {});
      } catch {
        // A host callback cannot interrupt or close the watch session, whether
        // it throws synchronously or rejects asynchronously.
      }
    }
  });

  return {
    reporter: {
      flushOutputStreams: false,
      onTestRunStart() {
        cycleFiles = [];
      },
      onTestFileResult(file) {
        cycleFiles.push(toPublicTestFileRunResult(file));
      },
      onTestRunEnd({ unhandledErrors, duration, coverage, snapshotSummary }) {
        captured = {
          files: cycleFiles,
          unhandledErrors: (unhandledErrors ?? []).map((error) =>
            toSerializedError(error),
          ),
          duration: { total: duration.totalTime },
          snapshot: snapshotSummary,
          coverage,
        };
      },
      onExit() {
        captured = undefined;
        cycleFiles = [];
        resolveResult = undefined;
        removeCycleEndListener();
      },
    },
    nextResult: () =>
      new Promise<TestRunResult>((resolve) => {
        resolveResult = resolve;
      }),
    errorResult(error) {
      const failedCycle: CapturedCycle = captured ?? {
        files: cycleFiles,
        unhandledErrors: [],
        duration: { total: 0 },
        snapshot: context.snapshotManager.summary,
      };
      failedCycle.unhandledErrors.unshift(toSerializedError(error));
      return createResult(context, failedCycle);
    },
  };
}

export function createErrorResult(error: unknown): TestRunResult {
  return {
    status: 'error',
    files: [],
    summary: computeSummary([]),
    unhandledErrors: [toSerializedError(error)],
    duration: { total: 0 },
  };
}
