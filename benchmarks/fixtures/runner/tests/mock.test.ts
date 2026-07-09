import { describe, expect, it, rstest } from '@rstest/core';

describe('runtime mocks', () => {
  it('tracks mock calls and return values', () => {
    const fn = rstest
      .fn((value: string) => value.toUpperCase())
      .mockName('upper');

    expect(fn('rstest')).toBe('RSTEST');
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('rstest');
  });

  it('supports async mock helpers', async () => {
    const fn = rstest.fn().mockResolvedValue('done');
    await expect(fn()).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
