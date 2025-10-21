import { describe, expect, it } from '@rstest/core';

describe('basic', () => {
  it('a', () => {
    expect(1 + 1).toBe(2);
  });

  it('b', () => {
    expect(1 + 1).not.toBe(2);
  });

  it.skip('c', () => {
    expect(1 + 1).not.toBe(2);
  });
});
