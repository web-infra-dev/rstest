import type { InternalContext, Reporter } from '../types';
import type { TestRunResult, WatchOptions } from './types';

export type ResultReporter = {
  reporter: Reporter;
  nextResult(): Promise<TestRunResult>;
};

export function createResultReporter(
  context: InternalContext,
  { onResult }: Pick<WatchOptions, 'onResult'> = {},
): ResultReporter {
  let captured: TestRunResult | undefined;
  let resolveResult: ((result: TestRunResult) => void) | undefined;

  const removeCycleEndListener = context.exitCode.onCycleEnd(() => {
    if (!captured) {
      return;
    }
    const trace = context.getTraceOutput?.();
    const result: TestRunResult = {
      ...captured,
      // Global teardown (or a reporter closing hook) can raise the exit code
      // after the payload was dispatched, so the resolved result still reports
      // the failure even though `onTestRunEnd` kept its captured status.
      status:
        captured.status === 'passed' && context.exitCode.current !== 0
          ? 'failed'
          : captured.status,
      ...(trace && { trace }),
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
