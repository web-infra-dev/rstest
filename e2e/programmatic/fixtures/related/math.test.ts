import { describe, expect, it } from '@rstest/core';
import { add } from './src/math';

describe('math', () => {
  it('adds', () => {
    expect(add(1, 2)).toBe(3);
  });
});
