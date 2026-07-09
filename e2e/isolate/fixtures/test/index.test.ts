import { describe, expect, it } from '@rstest/core';
import { sleep } from '../../../scripts/utils';
import { getCount, increment } from '../src/index';

process.env.index = '1';
globalThis.index = '1';

describe('Test isolate', () => {
  it('should get process.env index correctly', async () => {
    await sleep(200);
    expect(process.env.index).toBe('1');
    expect(process.env.index1).toBeUndefined();
  });

  it('should get globalThis index correctly', async () => {
    await sleep(200);
    expect(globalThis.index).toBe('1');
    expect(globalThis.index1).toBeUndefined();
  });

  it('should call source code isolate', async () => {
    increment();
    expect(getCount()).toBe(1);
  });
});
