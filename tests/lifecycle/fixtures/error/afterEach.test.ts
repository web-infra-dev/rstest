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

  afterEach(() => {
    throw new Error('afterEach error');
  });

  afterEach(() => {
    console.log('[afterEach - 0] should run');
  });
});
