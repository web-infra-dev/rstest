import { describe, expect, it } from '@rstest/core';
import { getCount, increment } from '../src/index';

process.env.index1 = '1';
globalThis.index1 = '1';

describe('Test isolate - 1', () => {
  it('should get process.env index1 correctly', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(process.env.index1).toBe('1');
    expect(process.env.index).toBeUndefined();
  });

  it('should get global index1 correctly', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(globalThis.index1).toBe('1');
    expect(globalThis.index).toBeUndefined();
  });

  it('should call source code isolate', async () => {
    increment();
    expect(getCount()).toBe(1);
  });
});
