import { describe, expect, it, rstest } from '@rstest/core';
import { createHeadlessLatestRerunScheduler } from '../src/headlessLatestRerunScheduler';

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T = void>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

type ActiveRun = {
  token: number;
  cancelled: boolean;
};

describe('headless latest rerun scheduler', () => {
  it('should invalidate and interrupt active run before scheduling latest files', async () => {
    const steps: string[] = [];
    let activeRun: ActiveRun | null = { token: 1, cancelled: false };

    const scheduler = createHeadlessLatestRerunScheduler<string, ActiveRun>({
      getActiveRun: () => activeRun,
      isRunCancelled: (run) => run.cancelled,
      invalidateActiveRun: () => {
        steps.push('invalidate');
      },
      interruptActiveRun: async (run) => {
        steps.push(`interrupt:${run.token}`);
        activeRun = null;
      },
      runFiles: async (files) => {
        steps.push(`run:${files.join(',')}`);
      },
      onInterrupt: (run) => {
        steps.push(`onInterrupt:${run.token}`);
      },
    });

    await scheduler.enqueueLatest(['A']);
    await scheduler.whenIdle();

    expect(steps).toEqual([
      'onInterrupt:1',
      'invalidate',
      'interrupt:1',
      'run:A',
    ]);
  });

  it('should keep only latest pending files when enqueueing rapidly', async () => {
    const firstRunGate = createDeferred<void>();
    const runCalls: string[] = [];

    const scheduler = createHeadlessLatestRerunScheduler<string, ActiveRun>({
      getActiveRun: () => null,
      isRunCancelled: () => false,
      invalidateActiveRun: () => {},
      interruptActiveRun: async () => {},
      runFiles: async (files) => {
        runCalls.push(files.join(','));
        if (files.includes('A')) {
          await firstRunGate.promise;
        }
      },
    });

    await scheduler.enqueueLatest(['A']);
    await scheduler.enqueueLatest(['B']);
    await scheduler.enqueueLatest(['C']);

    firstRunGate.resolve();
    await scheduler.whenIdle();

    expect(runCalls).toEqual(['A', 'C']);
  });

  it('should continue draining after runFiles throws', async () => {
    const firstRunGate = createDeferred<void>();
    const runCalls: string[] = [];
    const onError = rstest.fn();

    const scheduler = createHeadlessLatestRerunScheduler<string, ActiveRun>({
      getActiveRun: () => null,
      isRunCancelled: () => false,
      invalidateActiveRun: () => {},
      interruptActiveRun: async () => {},
      runFiles: async (files) => {
        const label = files.join(',');
        runCalls.push(label);
        if (label === 'A') {
          await firstRunGate.promise;
          throw new Error('run failed');
        }
      },
      onError: async (error) => {
        onError(error);
      },
    });

    await scheduler.enqueueLatest(['A']);
    await scheduler.enqueueLatest(['B']);

    firstRunGate.resolve();
    await scheduler.whenIdle();

    expect(runCalls).toEqual(['A', 'B']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('run failed');
  });

  it('should not overwrite latest payload when earlier enqueue resumes later', async () => {
    const firstInterruptGate = createDeferred<void>();
    const secondInterruptGate = createDeferred<void>();
    const runCalls: string[] = [];
    let interruptCallCount = 0;
    const activeRun: ActiveRun = { token: 1, cancelled: false };

    const scheduler = createHeadlessLatestRerunScheduler<string, ActiveRun>({
      getActiveRun: () => activeRun,
      isRunCancelled: (run) => run.cancelled,
      invalidateActiveRun: () => {},
      interruptActiveRun: async () => {
        interruptCallCount += 1;
        if (interruptCallCount === 1) {
          await firstInterruptGate.promise;
          return;
        }
        await secondInterruptGate.promise;
      },
      runFiles: async (files) => {
        runCalls.push(files.join(','));
      },
    });

    const first = scheduler.enqueueLatest(['old']);
    const second = scheduler.enqueueLatest(['new']);

    secondInterruptGate.resolve();
    await second;
    await scheduler.whenIdle();

    firstInterruptGate.resolve();
    await first;
    await scheduler.whenIdle();

    expect(runCalls).toEqual(['new']);
  });

  it('whenIdle should resolve after draining finishes', async () => {
    const gate = createDeferred<void>();
    let idleResolved = false;

    const scheduler = createHeadlessLatestRerunScheduler<string, ActiveRun>({
      getActiveRun: () => null,
      isRunCancelled: () => false,
      invalidateActiveRun: () => {},
      interruptActiveRun: async () => {},
      runFiles: async () => {
        await gate.promise;
      },
    });

    await scheduler.enqueueLatest(['A']);
    const idlePromise = scheduler.whenIdle().then(() => {
      idleResolved = true;
    });

    await Promise.resolve();
    expect(idleResolved).toBe(false);

    gate.resolve();
    await idlePromise;
    expect(idleResolved).toBe(true);
  });
});
