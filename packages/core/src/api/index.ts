import { type RunnerAPI, type TestRunner, createRunner } from '../runner';
import type { WorkerState } from '../types';
import { GLOBAL_EXPECT, type RstestExpect, createExpect } from './expect';
export type Rstest = RunnerAPI & {
  expect: RstestExpect;
};

export const createRstestRuntime = (
  workerState: WorkerState,
): {
  runner: TestRunner;
  api: Rstest;
} => {
  const { runner, api: runnerAPI } = createRunner();

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
