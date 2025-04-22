import { afterAll, afterEach, describe, expect, it } from '@rstest/core';

describe('test afterEach error', () => {
  it('it in level A', () => {
    console.log('[test] should run');
    expect(1 + 1).toBe(2);
  });

  afterAll(() => {
    console.log('[afterAll] should run');
  });

  afterEach(() => {
    console.log('[afterEach - 2] should not run');
  });

  // biome-ignore lint/suspicious/noDuplicateTestHooks: test
  afterEach(() => {
    throw new Error('afterEach error');
  });

  // biome-ignore lint/suspicious/noDuplicateTestHooks: test
  afterEach(() => {
    console.log('[afterEach - 0] should run');
  });
});
