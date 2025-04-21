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

  const it = ((name, fn, timeout) =>
    runtimeAPI.it(name, fn, timeout)) as TestAPI;
  it.fails = runtimeAPI.fails.bind(runtimeAPI);
  it.todo = (name, fn, timeout) => runtimeAPI.it(name, fn, timeout, 'todo');
  it.skip = (name, fn, timeout) => runtimeAPI.it(name, fn, timeout, 'skip');
  it.only = (name, fn, timeout) => runtimeAPI.it(name, fn, timeout, 'only');

  const describe = ((name, fn) => runtimeAPI.describe(name, fn)) as DescribeAPI;
  describe.only = (name, fn) => runtimeAPI.describe(name, fn, 'only');
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
