import type { SnapshotClient } from '@vitest/snapshot';
import { createRunner } from '../../../src/runtime/runner';
import { runtimeAPI } from '../../../src/runtime/runner/runtime';
import type { TaskContext } from '../../../src/runtime/worker/taskContext';
import type { Rstest, RuntimeConfig, WorkerState } from '../../../src/types';

describe('snapshot lifecycle hooks', () => {
  it('wraps snapshot setup and finish', async () => {
    const events: string[] = [];
    const snapshotClient = {
      setup: async () => {
        events.push('setup');
      },
      finish: async () => {
        events.push('finish');
        return {};
      },
      skipTest: () => {},
    } as unknown as SnapshotClient;
    const workerState = {
      project: 'test',
      projectRoot: process.cwd(),
      rootPath: process.cwd(),
      runtimeConfig: {
        passWithNoTests: true,
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
    runtimeAPI.it.skip('case', () => {});

    await runner.runTests(
      __filename,
      {
        onSnapshotSetupStart: async () => {
          events.push('setup-start');
        },
        onSnapshotSetupEnd: async () => {
          events.push('setup-end');
        },
        onSnapshotFinishStart: async () => {
          events.push('finish-start');
        },
        onSnapshotFinishEnd: async () => {
          events.push('finish-end');
        },
        getCountOfFailedTests: async () => 0,
      },
      {} as Rstest,
    );

    expect(events).toEqual([
      'setup-start',
      'setup',
      'setup-end',
      'finish-start',
      'finish',
      'finish-end',
    ]);
  });
});
