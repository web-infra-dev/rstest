import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@rstest/core';

beforeAll(() => {
  throw new Error('beforeAll error');
});

afterAll(() => {
  console.log('[afterAll] should run root');
});

describe('test beforeAll error', () => {
  beforeAll(() => {
    console.log('[beforeAll - 0] should not run');
  });

  beforeEach(() => {
    console.log('[beforeEach] should not run');
  });

  it('it in level A', () => {
    console.log('[test] should not run');
    expect(1 + 1).toBe(2);
  });

  it('it in level A - B', () => {
    console.log('[test -1] should not run');
    expect(1 + 1).toBe(2);
  });

  afterEach(() => {
    console.log('[afterEach] should not run');
  });

  afterAll(() => {
    console.log('[afterAll -1] should not run');
  });
});
