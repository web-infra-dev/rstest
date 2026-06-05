import { describe, expect, it } from '@rstest/core';

describe('async leak', () => {
  it('cleans up a timer', () => {
    const timer = setInterval(() => {}, 1000);
    clearInterval(timer);
    expect(1).toBe(1);
  });
});
