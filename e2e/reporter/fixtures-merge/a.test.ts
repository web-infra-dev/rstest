import { describe, expect, it } from '@rstest/core';
import { add, subtract } from './src/math';

describe('shard-a', () => {
  it('test a1', () => {
    expect(add(1, 1)).toBe(2);
  });

  it('test a2', () => {
    expect(subtract(4, 2)).toBe(2);
  });
});
