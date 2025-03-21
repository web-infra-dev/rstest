import { type TestRunner, createRunner } from '../runner';
import type { Rstest, RstestExpect, WorkerState } from '../types';
import { GLOBAL_EXPECT, createExpect } from './expect';

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
