import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';

describe('runtime hooks', () => {
  let state: string[];
  let cleanupCount = 0;

  beforeEach(() => {
    state = ['setup'];
  });

  afterEach(() => {
    cleanupCount += 1;
  });

  it('provides fresh state for each test', () => {
    state.push('test');
    expect(state).toEqual(['setup', 'test']);
  });

  it('starts clean on the next test', () => {
    expect(state).toEqual(['setup']);
    expect(cleanupCount).toBe(1);
  });
});
