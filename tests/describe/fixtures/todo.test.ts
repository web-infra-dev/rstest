import { beforeAll, beforeEach, describe, expect, it } from '@rstest/core';

beforeAll(() => {
  console.log('[beforeAll] should not run');
});

beforeEach(() => {
  console.log('[beforeEach] should not run');
});

describe.todo('should skip', () => {
  it('test 1', () => {
    console.log('[test 1] should not run');
    expect(1 + 1).toBe(2);
  });

  it('test 2', () => {
    expect(1 + 1).toBe(2);
  });
});
