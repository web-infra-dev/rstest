import { describe, expect, it } from '@rstest/core';

const sleep = (ms: number) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

describe('Async operations', () => {
  it('should handle setTimeout', async () => {
    let resolved = false;

    globalThis.setTimeout(() => {
      resolved = true;
    }, 50);

    expect(resolved).toBe(false);
    await sleep(100);
    expect(resolved).toBe(true);
  });

  it('should handle Promise.resolve', async () => {
    const result = await Promise.resolve('resolved');
    expect(result).toBe('resolved');
  });

  it('should handle async/await', async () => {
    const asyncFn = async () => {
      await sleep(10);
      return 'done';
    };

    const result = await asyncFn();
    expect(result).toBe('done');
  });

  it('should handle requestAnimationFrame', async () => {
    let called = false;

    globalThis.requestAnimationFrame(() => {
      called = true;
    });

    // Wait for next frame
    await new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
    await sleep(50);

    expect(called).toBe(true);
  });

  it('should handle multiple async operations', async () => {
    const results: number[] = [];

    const task1 = sleep(30).then(() => results.push(1));
    const task2 = sleep(10).then(() => results.push(2));
    const task3 = sleep(20).then(() => results.push(3));

    await Promise.all([task1, task2, task3]);

    // Order based on timeout duration
    expect(results).toEqual([2, 3, 1]);
  });

  it('should handle setInterval', async () => {
    let count = 0;

    const intervalId = globalThis.setInterval(() => {
      count++;
    }, 20);

    await sleep(300);
    globalThis.clearInterval(intervalId);

    expect(count).toBeGreaterThanOrEqual(2);
  });
});
