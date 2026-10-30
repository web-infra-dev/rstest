import type { SnapshotClient } from '@vitest/snapshot';
import { createRunner } from '../../../src/runtime/runner';
import { runtimeAPI } from '../../../src/runtime/runner/runtime';
import type { TaskContext } from '../../../src/runtime/worker/taskContext';
import type { Rstest, RuntimeConfig, WorkerState } from '../../../src/types';

it('does not hold a case slot while its result hook is pending', async () => {
  const snapshotClient = {
    setup: async () => {},
    finish: async () => ({}),
    skipTest: () => {},
  } as unknown as SnapshotClient;
  const workerState = {
    project: 'test',
    projectRoot: process.cwd(),
    rootPath: process.cwd(),
    runtimeConfig: {
      maxConcurrency: 1,
    } as RuntimeConfig,
    taskId: 0,
    buildId: 0,
    outputModule: false,
    environment: 'node',
    testPath: __filename,
    distPath: __filename,
    snapshotClient,
    snapshotOptions: {},
  } as WorkerState;
  const taskContext: TaskContext = {
    getCurrent: () => undefined,
    run: (_task, fn) => fn(),
    setFallback: () => {},
  };
  const { runner } = createRunner({ workerState, taskContext });
  runtimeAPI.it.skip('first', () => {});
  runtimeAPI.it.skip('second', () => {});

  let releaseFirst!: () => void;
  const firstDelivery = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const delivered: string[] = [];
  const run = runner.runTests(
    __filename,
    {
      onTestCaseResult: (result) => {
        delivered.push(result.name);
        return result.name === 'first' ? firstDelivery : Promise.resolve();
      },
      getCountOfFailedTests: async () => 0,
    },
    {} as Rstest,
  );

  try {
    await expect
      .poll(() => delivered, { timeout: 500 })
      .toEqual(['first', 'second']);
  } finally {
    releaseFirst();
    await run;
  }
});
