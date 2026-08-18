import type {
  CoverageMapData,
  FormattedError,
  Reporter,
  RstestContext,
  SnapshotSummary,
  TestFileResult as InternalTestFileResult,
  TestResult as InternalTestResult,
} from '../types';
import type {
  SerializedError,
  TestFileResult,
  TestResult,
  TestRunResult,
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
  const value = error as Partial<FormattedError> & { cause?: unknown };
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

export const toPublicTestResult = (result: InternalTestResult): TestResult => ({
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

export const toPublicTestFileResult = (
  result: InternalTestFileResult,
): TestFileResult => ({
  ...toPublicTestResult(result),
  results: result.results.map(toPublicTestResult),
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
    for (const test of file.results) {
      stats.tests.total++;
      switch (test.status) {
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

type CapturedCycle = {
  files: TestFileResult[];
  unhandledErrors: SerializedError[];
  duration: { total: number };
  snapshot: SnapshotSummary;
  coverage?: CoverageMapData;
};

const createResult = (
  context: RstestContext,
  captured: CapturedCycle,
  allowEmpty: boolean,
): TestRunResult => {
  const stats = computeStats(captured.files);
  const noTestsFailure =
    !allowEmpty &&
    captured.files.length === 0 &&
    !context.normalizedConfig.passWithNoTests;
  const ok =
    stats.tests.failed === 0 &&
    stats.files.failed === 0 &&
    captured.unhandledErrors.length === 0 &&
    !noTestsFailure &&
    context.exitCode.current === 0;

  return {
    ok,
    files: captured.files,
    stats,
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
  dispose(): void;
};

export function createResultReporter(
  context: RstestContext,
  {
    onResult,
    allowEmpty = false,
  }: {
    onResult?: (result: TestRunResult) => void;
    allowEmpty?: boolean;
  } = {},
): ResultReporter {
  let cycleFiles: TestFileResult[] = [];
  let captured: CapturedCycle | undefined;
  const waiters: Array<(result: TestRunResult) => void> = [];

  const removeCycleEndListener = context.exitCode.onCycleEnd(() => {
    if (!captured) {
      return;
    }
    const result = createResult(context, captured, allowEmpty);
    captured = undefined;
    waiters.shift()?.(result);
    try {
      Promise.resolve(onResult?.(result)).catch(() => {});
    } catch {
      // A host callback cannot interrupt or close the watch session, whether
      // it throws synchronously or rejects asynchronously.
    }
  });

  return {
    reporter: {
      flushOutputStreams: false,
      onTestRunStart() {
        cycleFiles = [];
      },
      onTestFileResult(file) {
        cycleFiles.push(toPublicTestFileResult(file));
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
    },
    nextResult: () =>
      new Promise<TestRunResult>((resolve) => {
        waiters.push(resolve);
      }),
    errorResult(error) {
      const failedCycle: CapturedCycle = captured ?? {
        files: cycleFiles,
        unhandledErrors: [],
        duration: { total: 0 },
        snapshot: context.snapshotManager.summary,
      };
      failedCycle.unhandledErrors.unshift(toSerializedError(error));
      return createResult(context, failedCycle, allowEmpty);
    },
    dispose() {
      captured = undefined;
      cycleFiles = [];
      waiters.length = 0;
      removeCycleEndListener();
    },
  };
}

export function createErrorResult(error: unknown): TestRunResult {
  return {
    ok: false,
    files: [],
    stats: computeStats([]),
    unhandledErrors: [toSerializedError(error)],
    duration: { total: 0 },
  };
}
