import { describe, expect, it, rstest } from '@rstest/core';

describe('async leak', () => {
  it('finishes leak collection when fake timers are active', () => {
    rstest.useFakeTimers();

    expect(rstest.isFakeTimers()).toBe(true);
  });
});
