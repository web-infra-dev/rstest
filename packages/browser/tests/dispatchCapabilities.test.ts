import { describe, expect, it, rstest } from '@rstest/core';
import { createHostDispatchRouter } from '../src/dispatchCapabilities';

const createRunnerCallbacks = () => {
  return {
    onTestFileStart: rstest.fn().mockResolvedValue(undefined),
    onTestFileReady: rstest.fn().mockResolvedValue(undefined),
    onTestSuiteStart: rstest.fn().mockResolvedValue(undefined),
    onTestSuiteResult: rstest.fn().mockResolvedValue(undefined),
    onTestCaseStart: rstest.fn().mockResolvedValue(undefined),
    onTestCaseResult: rstest.fn().mockResolvedValue(undefined),
    onTestFileComplete: rstest.fn().mockResolvedValue(undefined),
    onLog: rstest.fn().mockResolvedValue(undefined),
    onFatal: rstest.fn().mockResolvedValue(undefined),
  };
};

describe('dispatch capabilities', () => {
  it('should route runner lifecycle methods through runner namespace', async () => {
    const callbacks = createRunnerCallbacks();
    const router = createHostDispatchRouter({
      runnerCallbacks: callbacks,
      runSnapshotRpc: async () => undefined,
    });

    await router.dispatch({
      requestId: 'file-ready-1',
      namespace: 'runner',
      method: 'file-ready',
      args: { testPath: '/tests/a.test.ts', tests: [] },
    });
    await router.dispatch({
      requestId: 'suite-start-1',
      namespace: 'runner',
      method: 'suite-start',
      args: {
        testId: 'suite-1',
        testPath: '/tests/a.test.ts',
        type: 'suite',
        name: 'suite',
        parentNames: [],
        project: 'browser',
      },
    });
    await router.dispatch({
      requestId: 'case-start-1',
      namespace: 'runner',
      method: 'case-start',
      args: {
        testId: 'case-1',
        startTime: Date.now(),
        testPath: '/tests/a.test.ts',
        type: 'case',
        name: 'case',
        parentNames: ['suite'],
        project: 'browser',
      },
    });
    await router.dispatch({
      requestId: 'suite-result-1',
      namespace: 'runner',
      method: 'suite-result',
      args: {
        testId: 'suite-1',
        testPath: '/tests/a.test.ts',
        status: 'pass',
        name: 'suite',
        parentNames: [],
        project: 'browser',
      },
    });

    expect(callbacks.onTestFileReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onTestSuiteStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onTestCaseStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onTestSuiteResult).toHaveBeenCalledTimes(1);
  });
});
