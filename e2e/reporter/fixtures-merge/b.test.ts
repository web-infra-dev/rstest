import { describe, expect, it } from '@rstest/core';
import { divide, multiply } from './src/math';

describe('shard-b', () => {
  it('test b1', () => {
    expect(multiply(3, 3)).toBe(9);
  });

  it('test b2', () => {
    expect(divide(8, 4)).toBe(2);
  });
});
