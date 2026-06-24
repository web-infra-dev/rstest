import type {
  Rstest,
  RstestExpect,
  RunnerHooks,
  TestCase,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import { createRunner, runnerAPI } from '../runner';
import type { TaskContext } from '../worker/taskContext';
import { assert, createFileExpect, setupChaiConfig } from './expect';
import { createRstestUtilities } from './utilities';

/**
 * Live per-file API binding under `isolate: false` (the canonical contract).
 *
 * One worker runs many files: `@rstest/core`'s runtime is re-prepared per file
 * (#1373) but user modules persist, so any context-bound API value-copied into
 * a shared helper (`export const test = base.extend({})`, `{ ...rstest }`, a
 * snapshotted `expect.poll`) must not freeze to the first file's torn-down
 * context. ONE mechanism covers the whole surface: every injected member is
 * built once per worker with a stable identity and resolves the running file's
 * `FileContext` (`../fileContext`) at call time — never closing over a
 * per-file instance. `createRunner` republishes the context per file, and
 * per-file state is reset, not rebuilt:
 *
 *   - test / it / describe / hooks   → `runtimeAPI`            (runner/runtime.ts)
 *   - onTestFinished / onTestFailed  → `runnerAPI`             (runner/index.ts)
 *   - expect (incl. `.poll`/`.soft`) → `createFileExpect`      (./expect)
 *   - rstest / rs                    → `createRstestUtilities` (./utilities)
 *
 * The one intentional exception is the per-test local expect
 * (`context.expect`): created inside the running test, it can never be stale
 * and stays pinned to keep `test.concurrent` isolation.
 *
 * See https://github.com/web-infra-dev/rstest/issues/1376.
 */

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
  const [{ runner }, { SnapshotPlugin, ensureSnapshotClient }] =
    await Promise.all([
      Promise.resolve(createRunner({ workerState, taskContext })),
      import(/* webpackChunkName: "snapshot" */ './snapshot'),
    ]);

  if (workerState.runtimeConfig.chaiConfig) {
    setupChaiConfig(workerState.runtimeConfig.chaiConfig);
  }

  // The runner consumes this file's snapshot client for `setup`/`finish`; the
  // build-once snapshot plugin resolves it through the context at assert time.
  ensureSnapshotClient(workerState);

  const expect: RstestExpect = createFileExpect(SnapshotPlugin());

  const rstest = await createRstestUtilities();

  // Injected surface: build-once members only (see the contract above).
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

  // Published live for real-module importers (`public.ts` reads `RSTEST_API`).
  globalThis.RSTEST_API = runtime.api;

  return runtime;
};
