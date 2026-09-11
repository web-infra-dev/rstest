import type { InternalContext, Reporter } from '../types';
import type { TestRunResult, TestRunStatus, WatchOptions } from './types';

type CapturedCycle = Omit<TestRunResult, 'status'>;

const getStatus = (
  context: InternalContext,
  captured: CapturedCycle,
): TestRunStatus => {
  if (captured.unhandledErrors.length > 0) {
    return 'error';
  }
  // Watch resets exitCode each cycle, but the session summary retains earlier failures.
  if (context.exitCode.current !== 0 || captured.summary.files.failed > 0) {
    return 'fail';
  }
  return 'pass';
};

export type ResultReporter = {
  reporter: Reporter;
  nextResult(): Promise<TestRunResult>;
};

export function createResultReporter(
  context: InternalContext,
  { onResult }: Pick<WatchOptions, 'onResult'> = {},
): ResultReporter {
  let captured: CapturedCycle | undefined;
  let resolveResult: ((result: TestRunResult) => void) | undefined;

  const removeCycleEndListener = context.exitCode.onCycleEnd(() => {
    if (!captured) {
      return;
    }
    const result: TestRunResult = {
      ...captured,
      status: getStatus(context, captured),
    };
    captured = undefined;
    resolveResult?.(result);
    resolveResult = undefined;
    if (onResult) {
      try {
        Promise.resolve(
          onResult({ ...result, rerunTestPaths: result.rerunTestPaths! }),
        ).catch(() => {});
      } catch {
        // A host callback cannot interrupt or close the watch session, whether
        // it throws synchronously or rejects asynchronously.
      }
    }
  });

  return {
    reporter: {
      flushOutputStreams: false,
      onTestRunEnd({ getSourcemap: _getSourcemap, ...payload }) {
        captured = {
          ...payload,
          // The next watch cycle mutates the reporter's live arrays.
          results: [...payload.results],
          testResults: [...payload.testResults],
        };
      },
      onExit() {
        captured = undefined;
        resolveResult = undefined;
        removeCycleEndListener();
      },
    },
    nextResult: () =>
      new Promise<TestRunResult>((resolve) => {
        resolveResult = resolve;
      }),
  };
}
