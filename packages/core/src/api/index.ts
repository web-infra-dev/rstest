import { createRunner } from '../runner';
import type {
  Rstest,
  RstestExpect,
  RunnerHooks,
  TestCase,
  TestSummaryResult,
  WorkerState,
} from '../types';
import { GLOBAL_EXPECT, createExpect } from './expect';

export const createRstestRuntime = (
  workerState: WorkerState,
): {
  runner: {
    runTest: (
      testPath: string,
      hooks: RunnerHooks,
    ) => Promise<TestSummaryResult>;
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

  return {
    runner,
    api: {
      expect,
      ...runnerAPI,
    },
  };
};
