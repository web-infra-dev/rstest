import { describe, expect, it } from '@rstest/core';
import { sleep } from '../../scripts/utils';
import { getCount, increment } from '../src/index';

declare global {
  var index: string | undefined;
  var index1: string | undefined;
}

process.env.index1 = '1';
globalThis.index1 = '1';

describe('Test isolate - 1', () => {
  it('should get process.env index1 correctly', async () => {
    await sleep(200);
    expect(process.env.index1).toBe('1');
    expect(process.env.index).toBeUndefined();
  });

  it('should get global index1 correctly', async () => {
    await sleep(200);
    expect(globalThis.index1).toBe('1');
    expect(globalThis.index).toBeUndefined();
  });

  it('should call source code isolate - 1', async () => {
    increment();
    expect(getCount()).toBe(1);
  });
});
