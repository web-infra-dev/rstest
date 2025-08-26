import type {
  Rstest,
  RunnerAPI,
  RunnerHooks,
  Test,
  TestFileResult,
  WorkerState,
} from '../../types';

import { TestRunner } from './runner';
import { createRuntimeAPI } from './runtime';
import { traverseUpdateTest } from './task';

export function createRunner({ workerState }: { workerState: WorkerState }): {
  api: RunnerAPI;
  runner: {
    runTests: (
      testFilePath: string,
      hooks: RunnerHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    collectTests: () => Promise<Test[]>;
    getCurrentTest: TestRunner['getCurrentTest'];
  };
} {
  const {
    testPath,
    project,
    runtimeConfig: { testNamePattern },
  } = workerState;
  const runtime = createRuntimeAPI({
    project,
    testPath,
    runtimeConfig: workerState.runtimeConfig,
  });
  const testRunner: TestRunner = new TestRunner();

  return {
    api: {
      ...runtime.api,
      onTestFinished: (fn, timeout) => {
        testRunner.onTestFinished(testRunner.getCurrentTest(), fn, timeout);
      },
      onTestFailed: (fn, timeout) => {
        testRunner.onTestFailed(testRunner.getCurrentTest(), fn, timeout);
      },
    },
    runner: {
      runTests: async (testPath: string, hooks: RunnerHooks, api: Rstest) => {
        const tests = await runtime.instance.getTests();
        traverseUpdateTest(tests, testNamePattern);
        runtime.instance.updateStatus('running');

        const results = await testRunner.runTests({
          tests,
          testPath,
          state: workerState,
          hooks,
          api,
        });

        hooks.onTestFileResult?.(results);

        return results;
      },
      collectTests: async () => {
        const tests = await runtime.instance.getTests();
        traverseUpdateTest(tests, testNamePattern);

        return tests;
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
    },
  };
}
