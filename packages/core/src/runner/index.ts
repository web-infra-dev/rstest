import type {
  RunnerAPI,
  RunnerHooks,
  TestAPI,
  TestResult,
  WorkerContext,
} from '../types';

import { TestRunner } from './runner';
import { RunnerRuntime } from './runtime';

export function createRunner(): {
  api: RunnerAPI;
  runner: {
    runTest: (
      testFilePath: string,
      context: WorkerContext,
      hooks: RunnerHooks,
    ) => Promise<TestResult>;
    getCurrentTest: RunnerRuntime['getCurrentTest'];
  };
} {
  const runtimeAPI: RunnerRuntime = new RunnerRuntime();
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
