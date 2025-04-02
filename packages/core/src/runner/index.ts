import type {
  RunnerAPI,
  RunnerHooks,
  TestAPI,
  TestSummaryResult,
  WorkerContext,
  WorkerState,
} from '../types';

import { TestRunner } from './runner';
import { RunnerRuntime } from './runtime';

export function createRunner({ workerState }: { workerState: WorkerState }): {
  api: RunnerAPI;
  runner: {
    runTest: (
      testFilePath: string,
      context: WorkerContext,
      hooks: RunnerHooks,
    ) => Promise<TestSummaryResult>;
    getCurrentTest: RunnerRuntime['getCurrentTest'];
  };
} {
  const runtimeAPI: RunnerRuntime = new RunnerRuntime(workerState.sourcePath);
  const testRunner: TestRunner = new TestRunner();

  const describe: (description: string, fn: () => void) => void =
    runtimeAPI.describe.bind(runtimeAPI);
  const it = runtimeAPI.it.bind(runtimeAPI) as TestAPI;

  it.fails = runtimeAPI.fails.bind(runtimeAPI);
  it.todo = runtimeAPI.todo.bind(runtimeAPI);
  it.skip = runtimeAPI.skip.bind(runtimeAPI);

  return {
    api: {
      describe,
      it,
      test: it,
    },
    runner: {
      runTest: async (
        testFilePath: string,
        context: WorkerContext,
        hooks: RunnerHooks,
      ) => {
        return testRunner.runTests(
          runtimeAPI.getTests(),
          testFilePath,
          context,
          hooks,
        );
      },
      getCurrentTest: () => runtimeAPI.getCurrentTest(),
    },
  };
}
