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
import type { TaskContext } from '../worker/taskContext';
import { assert, createExpect, GLOBAL_EXPECT, setupChaiConfig } from './expect';
import { createRstestUtilities } from './utilities';

export const createRstestRuntime = async (
  workerState: WorkerState,
  { taskContext }: { taskContext: TaskContext },
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
  const [{ runner, api: runnerAPI }, { SnapshotPlugin }] = await Promise.all([
    Promise.resolve(createRunner({ workerState, taskContext })),
    import(/* webpackChunkName: "snapshot" */ './snapshot'),
  ]);

  if (workerState.runtimeConfig.chaiConfig) {
    setupChaiConfig(workerState.runtimeConfig.chaiConfig);
  }

  const expect: RstestExpect = createExpect({
    workerState,
    getCurrentTest: () => runner.getCurrentTest(),
    snapshotPlugin: SnapshotPlugin(workerState),
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
