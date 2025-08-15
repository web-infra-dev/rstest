import { afterAll, afterEach, describe, expect, it } from '@rstest/core';

describe('test afterAll error', () => {
  it('it in level A', () => {
    console.log('[test] should run');
    expect(1 + 1).toBe(2);
  });

  afterAll(() => {
    console.log('[afterAll - 2] should not run');
  });

  afterAll(() => {
    throw new Error('afterAll error');
  });

  afterAll(() => {
    console.log('[afterAll - 0] should run');
  });

  afterEach(() => {
    console.log('[afterEach] should run');
  });
});
