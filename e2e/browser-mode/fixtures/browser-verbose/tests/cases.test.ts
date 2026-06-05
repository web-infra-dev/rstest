import { describe, expect, it } from '@rstest/core';

describe('arithmetic', () => {
  it('alpha case passes', () => {
    expect(1 + 1).toBe(2);
  });

  it('beta case passes', () => {
    expect(2 * 2).toBe(4);
  });

  it('gamma case passes', () => {
    expect(3 - 1).toBe(2);
  });
});
