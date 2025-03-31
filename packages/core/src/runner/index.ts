import type {
  RunnerAPI,
  RunnerHooks,
  TestAPI,
  TestSummaryResult,
  WorkerState,
} from '../types';

import { TestRunner } from './runner';
import { RunnerRuntime } from './runtime';

export function createRunner({ workerState }: { workerState: WorkerState }): {
  api: RunnerAPI;
  runner: {
    runTest: (
      testFilePath: string,
      hooks: RunnerHooks,
    ) => Promise<TestSummaryResult>;
    getCurrentTest: RunnerRuntime['getCurrentTest'];
  };
} {
  const runtimeAPI: RunnerRuntime = new RunnerRuntime(workerState.sourcePath);
  const testRunner: TestRunner = new TestRunner();

  const it = runtimeAPI.it.bind(runtimeAPI) as TestAPI;
  it.fails = runtimeAPI.fails.bind(runtimeAPI);
  it.todo = runtimeAPI.todo.bind(runtimeAPI);
  it.skip = runtimeAPI.skip.bind(runtimeAPI);

  return {
    api: {
      describe: runtimeAPI.describe.bind(runtimeAPI),
      it,
      test: it,
      afterAll: runtimeAPI.afterAll.bind(runtimeAPI),
    },
    runner: {
      runTest: async (testFilePath: string, hooks: RunnerHooks) => {
        return testRunner.runTests(
          runtimeAPI.getTests(),
          testFilePath,
          workerState,
          hooks,
        );
      },
      getCurrentTest: () => runtimeAPI.getCurrentTest(),
    },
  };
}
