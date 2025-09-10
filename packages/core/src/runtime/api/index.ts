import type {
  Rstest,
  RstestExpect,
  RunnerHooks,
  Test,
  TestCase,
  TestFileResult,
  WorkerState,
} from '../../types';
import { createRunner } from '../runner';
import { assert, createExpect, GLOBAL_EXPECT } from './expect';
import { createRstestUtilities } from './utilities';

export const createRstestRuntime = (
  workerState: WorkerState,
): {
  runner: {
    runTests: (
      testPath: string,
      hooks: RunnerHooks,
      api: Rstest,
    ) => Promise<TestFileResult>;
    collectTests: () => Promise<Test[]>;
    getCurrentTest: () => TestCase | undefined;
  };
  api: Rstest;
} => {
  const { runner, api: runnerAPI } = createRunner({ workerState });

  const expect: RstestExpect = createExpect({
    workerState,
    getCurrentTest: () => runner.getCurrentTest(),
  });

  Object.defineProperty(globalThis, GLOBAL_EXPECT, {
    value: expect,
    writable: true,
    configurable: true,
  });

  const rstest = createRstestUtilities(workerState);

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
