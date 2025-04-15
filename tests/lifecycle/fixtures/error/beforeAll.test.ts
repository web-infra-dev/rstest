import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@rstest/core';

describe('test beforeAll error', () => {
  beforeAll(() => {
    console.log('[beforeAll - 0] should run');
  });

  // biome-ignore lint/suspicious/noDuplicateTestHooks: <explanation>
  beforeAll(() => {
    throw new Error('beforeAll error');
  });

  // biome-ignore lint/suspicious/noDuplicateTestHooks: <explanation>
  beforeAll(() => {
    console.log('[beforeAll - 2] should not run');
  });

  beforeEach(() => {
    console.log('[beforeEach] should not run');
  });

  it('it in level A', () => {
    console.log('[test] should not run');
    expect(1 + 1).toBe(2);
  });

  afterEach(() => {
    console.log('[afterEach] should not run');
  });

  afterAll(() => {
    console.log('[afterAll] should run');
  });
});
