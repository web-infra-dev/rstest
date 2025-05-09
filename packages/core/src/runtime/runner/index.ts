import type {
  Rstest,
  RunnerAPI,
  RunnerHooks,
  TestFileResult,
  WorkerState,
} from '../../types';

import { TestRunner } from './runner';
import { createRuntimeAPI } from './runtime';

export function createRunner({ workerState }: { workerState: WorkerState }): {
  api: RunnerAPI;
  runner: {
    runTest: (
      testFilePath: string,
      hooks: RunnerHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    getCurrentTest: TestRunner['getCurrentTest'];
  };
} {
  const {
    sourcePath,
    runtimeConfig: { testTimeout },
  } = workerState;
  const runtime = createRuntimeAPI({
    sourcePath,
    testTimeout,
  });
  const testRunner: TestRunner = new TestRunner();

  return {
    api: runtime.api,
    runner: {
      runTest: async (testPath: string, hooks: RunnerHooks, api: Rstest) => {
        const tests = await runtime.instance.getTests();
        return testRunner.runTests({
          tests,
          testPath,
          state: workerState,
          hooks,
          api,
        });
      },
      getCurrentTest: () => testRunner.getCurrentTest(),
    },
  };
}
