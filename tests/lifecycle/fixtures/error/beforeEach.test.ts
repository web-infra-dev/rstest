import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@rstest/core';

describe('test beforeEach error', () => {
  it('it in level A', () => {
    console.log('[test] should not run');
    expect(1 + 1).toBe(2);
  });

  beforeAll(() => {
    console.log('[beforeAll] should run');
  });

  beforeEach(() => {
    console.log('[beforeEach - 0] should run');
  });

  beforeEach(() => {
    throw new Error('beforeEach error');
  });

  beforeEach(() => {
    console.log('[beforeEach - 2] should not run');
  });

  afterAll(() => {
    console.log('[afterAll] should run');
  });

  afterEach(() => {
    console.log('[afterEach] should run');
  });
});
