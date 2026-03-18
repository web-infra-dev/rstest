import type {
  Rstest,
  RstestExpect,
  RunnerHooks,
  TestCase,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import { createRunner } from '../runner';
import { assert, createExpect, GLOBAL_EXPECT, setupChaiConfig } from './expect';
import { createRstestUtilities } from './utilities';

export const createRstestRuntime = async (
  workerState: WorkerState,
): Promise<{
  runner: {
    runTests: (
      testPath: string,
      hooks: RunnerHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    collectTests: () => Promise<TestInfo[]>;
    getCurrentTest: () => TestCase | undefined;
  };
  api: Rstest;
}> => {
  const { runner, api: runnerAPI } = createRunner({ workerState });

  if (workerState.runtimeConfig.chaiConfig) {
    setupChaiConfig(workerState.runtimeConfig.chaiConfig);
  }

  const expect: RstestExpect = createExpect({
    workerState,
    getCurrentTest: () => runner.getCurrentTest(),
  });

  Object.defineProperty(globalThis, GLOBAL_EXPECT, {
    value: expect,
    writable: true,
    configurable: true,
  });

  const rstest = await createRstestUtilities(workerState);

  const runtime = {
    runner,
    api: {
      ...runnerAPI,
      expect,
      assert,
      rstest,
      rs: rstest,
    },
  };

  globalThis.RSTEST_API = runtime.api;

  return runtime;
};
