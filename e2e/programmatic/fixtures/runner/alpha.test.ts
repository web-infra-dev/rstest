import { describe, expect, it } from '@rstest/core';

describe('alpha', () => {
  it('adds', () => {
    expect(1 + 2).toBe(3);
  });

  it('multiplies', () => {
    expect(2 * 3).toBe(6);
  });
});
