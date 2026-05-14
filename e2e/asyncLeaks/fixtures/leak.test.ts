import { describe, expect, it } from '@rstest/core';

describe('async leak', () => {
  it('leaks a timer', () => {
    setInterval(() => {}, 1000);
    expect(1).toBe(1);
  });
});
