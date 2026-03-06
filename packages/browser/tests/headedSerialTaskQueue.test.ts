import { describe, expect, it, rstest } from '@rstest/core';
import { createHeadedSerialTaskQueue } from '../src/headedSerialTaskQueue';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

const createDeferred = (): Deferred => {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('headed serial task queue', () => {
  it('should run enqueued tasks strictly in order', async () => {
    const queue = createHeadedSerialTaskQueue();
    const firstGate = createDeferred();
    const steps: string[] = [];

    const first = queue.enqueue(async () => {
      steps.push('first:start');
      await firstGate.promise;
      steps.push('first:end');
    });

    const second = queue.enqueue(async () => {
      steps.push('second:start');
      steps.push('second:end');
    });

    await Promise.resolve();
    expect(steps).toEqual(['first:start']);

    firstGate.resolve();
    await first;
    await second;

    expect(steps).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  it('should continue draining after a task failure', async () => {
    const queue = createHeadedSerialTaskQueue();
    const onSettled = rstest.fn();

    const first = queue.enqueue(async () => {
      throw new Error('boom');
    });

    const second = queue.enqueue(async () => {
      onSettled('second');
    });

    await expect(first).rejects.toThrow('boom');
    await second;

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('second');
  });
});
