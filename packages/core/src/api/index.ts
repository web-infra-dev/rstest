import { createRunner } from '../runner';
import type {
  Rstest,
  RstestExpect,
  RunnerHooks,
  TestCase,
  TestResult,
  WorkerContext,
  WorkerState,
} from '../types';
import { GLOBAL_EXPECT, createExpect } from './expect';

export const createRstestRuntime = (
  workerState: WorkerState,
): {
  runner: {
    runTest: (
      testPath: string,
      context: WorkerContext,
      hooks: RunnerHooks,
    ) => Promise<TestResult>;
    getCurrentTest: () => TestCase | undefined;
  };
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
