import { describe, expect, it } from '@rstest/core';
import { getCount, increment } from '../src/index';

describe('threads pool - basic', () => {
  it('runs sync tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs async tests', async () => {
    const value = await Promise.resolve(42);
    expect(value).toBe(42);
  });

  it('can import source modules and observe local mutation', () => {
    increment();
    expect(getCount()).toBe(1);
  });

  it('runs in a real worker_thread (parentPort is reachable)', async () => {
    // `process.send` is a fork-only IPC channel; under threads it is
    // undefined. This is the simplest invariant that distinguishes the two
    // pool types from the test runtime.
    expect(typeof process.send).toBe('undefined');
  });
});
