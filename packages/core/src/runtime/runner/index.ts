import type {
  DescribeAPI,
  RunnerAPI,
  RunnerHooks,
  TestAPI,
  TestFileResult,
  WorkerState,
} from '../../types';

import { TestRunner } from './runner';
import { RunnerRuntime } from './runtime';

export function createRunner({ workerState }: { workerState: WorkerState }): {
  api: RunnerAPI;
  runner: {
    runTest: (
      testFilePath: string,
      hooks: RunnerHooks,
    ) => Promise<TestFileResult>;
    getCurrentTest: TestRunner['getCurrentTest'];
  };
} {
  const runtimeAPI: RunnerRuntime = new RunnerRuntime(workerState.sourcePath);
  const testRunner: TestRunner = new TestRunner();

  const it = ((name, fn) => runtimeAPI.it(name, fn)) as TestAPI;
  it.fails = runtimeAPI.fails.bind(runtimeAPI);
  it.todo = (name, fn) => runtimeAPI.it(name, fn, 'todo');
  it.skip = (name, fn) => runtimeAPI.it(name, fn, 'skip');

  const describe = ((name, fn) => runtimeAPI.describe(name, fn)) as DescribeAPI;
  describe.todo = (name, fn) => runtimeAPI.describe(name, fn, 'todo');
  describe.skip = (name, fn) => runtimeAPI.describe(name, fn, 'skip');

  return {
    api: {
      describe,
      it,
      test: it,
      afterAll: runtimeAPI.afterAll.bind(runtimeAPI),
      beforeAll: runtimeAPI.beforeAll.bind(runtimeAPI),
      afterEach: runtimeAPI.afterEach.bind(runtimeAPI),
      beforeEach: runtimeAPI.beforeEach.bind(runtimeAPI),
    },
    runner: {
      runTest: async (testFilePath: string, hooks: RunnerHooks) => {
        const tests = await runtimeAPI.getTests();
        return testRunner.runTests(tests, testFilePath, workerState, hooks);
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
    },
  };
}
