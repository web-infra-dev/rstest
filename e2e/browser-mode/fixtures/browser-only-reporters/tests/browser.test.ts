import { describe, expect, it } from '@rstest/core';

describe('browser-only reporter output', () => {
  it('runs in the browser', () => {
    expect(typeof window).toBe('object');
  });

  it('runs a second case', () => {
    expect(1 + 1).toBe(2);
  });
});
