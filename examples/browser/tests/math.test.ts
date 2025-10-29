import { describe, expect, it } from '@rstest/core';

describe('math suite', () => {
  it('adds numbers', () => {
    expect(1 + 2).toBe(3);
  });

  it('handles multiple expectations', () => {
    expect(Math.max(2, 5, 1)).toBe(5);
    expect(Math.min(2, 5, 1)).toBe(1);
  });
});
