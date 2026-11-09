import type { SnapshotClient } from '@vitest/snapshot';
import { createRunner } from '../../../src/runtime/runner';
import { runtimeAPI } from '../../../src/runtime/runner/runtime';
import type { TaskContext } from '../../../src/runtime/worker/taskContext';
import type {
  Rstest,
  RunnerHooks,
  RuntimeConfig,
  WorkerState,
} from '../../../src/types';
import { createDeferred } from '../../../src/utils';

const createTestRunner = (
  setup: SnapshotClient['setup'] = rs.fn(async () => {}),
) => {
  const snapshotClient = {
    setup,
    finish: rs.fn(async () => ({})),
    skipTest: rs.fn(),
  };
  const workerState = {
    project: 'test',
    projectRoot: process.cwd(),
    rootPath: process.cwd(),
    runtimeConfig: {
      passWithNoTests: true,
      sequence: { hooks: 'stack' },
    } as RuntimeConfig,
    taskId: 0,
    buildId: 0,
    outputModule: false,
    environment: 'node',
    testPath: __filename,
    distPath: __filename,
    snapshotClient: snapshotClient as unknown as SnapshotClient,
    snapshotOptions: {},
  } as WorkerState;
  const taskContext: TaskContext = {
    getCurrent: () => undefined,
    run: (_task, fn) => fn(),
    setFallback: () => {},
  };
  return { ...createRunner({ workerState, taskContext }), snapshotClient };
};

const hooks: RunnerHooks = { getCountOfFailedTests: async () => 0 };
const api = {} as Rstest;
const unpreparedMessage = 'prepareTests() must complete before runTests().';

describe('runner preparation and snapshot lifecycle', () => {
  it('sets up snapshots once, closes setup hooks before collection, and finishes during run', async () => {
    const events: string[] = [];
    const { runner, snapshotClient } = createTestRunner(
      rs.fn(async () => {
        events.push('setup');
      }),
    );
    snapshotClient.finish.mockImplementation(async () => {
      events.push('finish');
      return {};
    });
    runtimeAPI.describe('suite', async () => {
      events.push('collect');
      runtimeAPI.it.skip('case', () => {});
    });
    const lifecycleHooks: RunnerHooks = {
      ...hooks,
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
    };

    expect(
      await runner.prepareTests(__filename, lifecycleHooks),
    ).toBeUndefined();
    expect(events).toEqual(['setup-start', 'setup', 'setup-end', 'collect']);
    await runner.prepareTests(__filename, lifecycleHooks);
    await runner.runTests(__filename, lifecycleHooks, api);

    expect(snapshotClient.setup).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'setup-start',
      'setup',
      'setup-end',
      'collect',
      'finish-start',
      'finish',
      'finish-end',
    ]);
  });

  it('rejects execution before preparation', async () => {
    const { runner, snapshotClient } = createTestRunner();
    await expect(runner.runTests(__filename, hooks, api)).rejects.toThrow(
      unpreparedMessage,
    );
    expect(snapshotClient.setup).not.toHaveBeenCalled();
    expect(snapshotClient.finish).not.toHaveBeenCalled();
  });

  it('collects and filters tests without initializing snapshots or preparing execution', async () => {
    const { runner, snapshotClient } = createTestRunner();
    const collect = rs.fn(() => {
      runtimeAPI.it.skip('case', () => {});
    });
    runtimeAPI.describe('suite', collect);

    const tests = await runner.collectTests();
    expect(tests).toMatchObject([
      { type: 'suite', tests: [{ name: 'case', runMode: 'skip' }] },
    ]);
    await runner.collectTests();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(snapshotClient.setup).not.toHaveBeenCalled();
    await expect(runner.runTests(__filename, hooks, api)).rejects.toThrow(
      unpreparedMessage,
    );
  });

  it('rejects execution while snapshot preparation is pending', async () => {
    const setup = createDeferred();
    const { runner } = createTestRunner(() => setup.promise);
    const preparing = runner.prepareTests(__filename);
    try {
      await expect(runner.runTests(__filename, hooks, api)).rejects.toThrow(
        unpreparedMessage,
      );
    } finally {
      setup.resolve();
      await preparing;
    }
  });

  it('ends snapshot setup hooks on setup failure and leaves execution unprepared', async () => {
    const error = new Error('snapshot setup failed');
    const { runner } = createTestRunner(async () => {
      throw error;
    });
    const end = rs.fn(async () => {});
    const collect = rs.fn();
    runtimeAPI.describe('suite', collect);

    await expect(
      runner.prepareTests(__filename, {
        ...hooks,
        onSnapshotSetupEnd: end,
      }),
    ).rejects.toBe(error);
    expect(end).toHaveBeenCalledTimes(1);
    expect(collect).not.toHaveBeenCalled();
    await expect(runner.runTests(__filename, hooks, api)).rejects.toThrow(
      unpreparedMessage,
    );
  });

  it('leaves execution unprepared when collection fails', async () => {
    const error = new Error('collection failed');
    const { runner } = createTestRunner();
    runtimeAPI.describe('suite', () => {
      throw error;
    });

    await expect(runner.prepareTests(__filename)).rejects.toBe(error);
    await expect(runner.runTests(__filename, hooks, api)).rejects.toThrow(
      unpreparedMessage,
    );
  });
});
