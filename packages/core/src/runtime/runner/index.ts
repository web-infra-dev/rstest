import type {
  Rstest,
  RunnerAPI,
  RunnerHooks,
  Test,
  TestFileResult,
  TestInfo,
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
    collectTests: () => Promise<TestInfo[]>;
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
        const snapshotClient = workerState.snapshotClient!;

        await snapshotClient.setup(testPath, workerState.snapshotOptions);

        const tests = await runtime.instance.getTests();
        traverseUpdateTest(tests, testNamePattern);
        hooks.onTestFileReady?.({
          testPath,
          tests: tests.map(toTestInfo),
        });
        runtime.instance.updateStatus('running');

        const results = await testRunner.runTests({
          tests,
          testPath,
          state: workerState,
          hooks,
          api,
          snapshotClient,
        });

        return results;
      },
      collectTests: async () => {
        const tests = await runtime.instance.getTests();
        traverseUpdateTest(tests, testNamePattern);

        return tests.map(toTestInfo);
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
    },
  };
}

function toTestInfo(test: Test): TestInfo {
  return {
    testId: test.testId,
    name: test.name,
    parentNames: test.parentNames,
    testPath: test.testPath,
    project: test.project,
    type: test.type,
    location: test.location,
    tests: test.type === 'suite' ? test.tests.map(toTestInfo) : [],
    runMode: test.runMode,
  };
}
