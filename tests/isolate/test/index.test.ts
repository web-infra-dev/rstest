import { describe, expect, it } from '@rstest/core';

process.env.index = '1';
globalThis.index = '1';

describe('Test isolate', () => {
  it('should get process.env index correctly', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(process.env.index).toBe('1');
    expect(process.env.index1).toBeUndefined();
  });

  it('should get globalThis index correctly', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(globalThis.index).toBe('1');
    expect(globalThis.index1).toBeUndefined();
  });
});
