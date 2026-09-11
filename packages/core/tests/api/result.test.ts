import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { rs, type Reporter } from '@rstest/core';
import type { TestRunResult } from '@rstest/core/api';
import { join } from 'pathe';
import { createResultReporter } from '../../src/api/result';
import { Rstest } from '../../src/core/rstest';
import { emptyRunEndPayload } from '../reporter/helpers';

type TestFileResult = TestRunResult['results'][number];
type TestRunEndPayload = Parameters<NonNullable<Reporter['onTestRunEnd']>>[0];

type Assert<Condition extends true> = Condition;
export type TestRunResultHasNoFunctions = Assert<
  Extract<
    TestRunResult[keyof TestRunResult],
    (...args: never[]) => unknown
  > extends never
    ? true
    : false
>;

const rootPath = join(__dirname, '../..');

const createFileResult = (status: 'pass' | 'fail'): TestFileResult => ({
  testId: '/first.test.ts',
  name: '/first.test.ts',
  status,
  testPath: '/first.test.ts',
  project: 'node-a',
  results: [],
});

const createPayload = (
  context: Rstest,
  results: TestFileResult[] = [],
): TestRunEndPayload => ({
  ...emptyRunEndPayload,
  results,
  testResults: [],
  summary: {
    tests: { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0 },
    files: { total: 1, failed: 0 },
  },
  duration: { totalTime: 3, buildTime: 1, testTime: 2 },
  snapshotSummary: context.snapshotManager.summary,
  rerunTestPaths: ['/first.test.ts'],
});

describe('createResultReporter', () => {
  it('captures the reporter payload without its resolver and stabilizes live arrays', () => {
    const context = new Rstest(
      {
        cwd: rootPath,
        command: 'watch',
        projects: [],
      },
      {},
    );
    const onResult = rs.fn();
    const capture = createResultReporter(context, { onResult });
    const results = [createFileResult('pass')];
    const payload = createPayload(context, results);

    capture.reporter.onTestRunEnd?.(payload);
    results.push({ ...createFileResult('pass'), testPath: '/later.test.ts' });
    payload.testResults.push({
      ...createFileResult('pass'),
      name: 'later test',
      testPath: '/later.test.ts',
    });
    context.exitCode.finishCycle();

    expect(onResult).toHaveBeenCalledWith({
      results: [createFileResult('pass')],
      testResults: [],
      summary: payload.summary,
      duration: payload.duration,
      snapshotSummary: payload.snapshotSummary,
      unhandledErrors: [],
      rerunTestPaths: ['/first.test.ts'],
      status: 'pass',
    });
    expect(onResult.mock.calls[0]![0]).not.toHaveProperty('getSourcemap');
  });

  it('isolates rejected async result callbacks and keeps emitting', async () => {
    const context = new Rstest(
      {
        cwd: rootPath,
        command: 'watch',
        projects: [],
      },
      {},
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    let callbackCount = 0;
    const capture = createResultReporter(context, {
      async onResult() {
        callbackCount += 1;
        if (callbackCount === 1) {
          await Promise.resolve();
          throw new Error('host callback failed');
        }
      },
    });
    const emitCycle = async (): Promise<void> => {
      await capture.reporter.onTestRunEnd?.({
        ...emptyRunEndPayload,
        snapshotSummary: context.snapshotManager.summary,
        rerunTestPaths: [],
      });
      context.exitCode.finishCycle();
    };

    try {
      await emitCycle();
      await waitForImmediate();
      await emitCycle();
      await waitForImmediate();

      expect(callbackCount).toBe(2);
      expect(unhandledRejections).toEqual([]);
    } finally {
      await capture.reporter.onExit?.();
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
