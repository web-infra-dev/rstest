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

describe('headless latest rerun scheduler', () => {
  it('should keep only latest pending files when enqueueing rapidly', async () => {
    const firstRunGate = createDeferred<void>();
    const runCalls: string[] = [];

    const scheduler = createHeadlessLatestRerunScheduler<string>({
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

    const scheduler = createHeadlessLatestRerunScheduler<string>({
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

  it('should not interrupt active run when newer payload arrives', async () => {
    const firstRunGate = createDeferred<void>();
    const runCalls: string[] = [];

    const scheduler = createHeadlessLatestRerunScheduler<string>({
      runFiles: async (files) => {
        runCalls.push(files.join(','));
        if (files.includes('old')) {
          await firstRunGate.promise;
        }
      },
    });

    await scheduler.enqueueLatest(['old']);
    await scheduler.enqueueLatest(['new']);

    firstRunGate.resolve();
    await scheduler.whenIdle();

    expect(runCalls).toEqual(['old', 'new']);
  });

  it('whenIdle should resolve after draining finishes', async () => {
    const gate = createDeferred<void>();
    let idleResolved = false;

    const scheduler = createHeadlessLatestRerunScheduler<string>({
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
