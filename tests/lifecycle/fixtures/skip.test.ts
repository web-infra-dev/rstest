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
  console.log('[beforeAll] should not run root');
});

afterAll(() => {
  console.log('[afterAll] should not run root');
});

describe('level A', () => {
  beforeAll(() => {
    console.log('[beforeAll] should not run');
  });

  beforeEach(() => {
    console.log('[beforeEach] should not run');
  });

  it.skip('it in level A', () => {
    expect(2 + 2).toBe(4);
  });

  it.todo('it in level A', () => {
    expect(2 + 2).toBe(4);
  });

  afterEach(() => {
    console.log('[afterEach] should not run');
  });

  afterAll(() => {
    console.log('[afterAll] should not run');
  });
});

it.skip('it in level B', () => {
  expect(2 + 2).toBe(4);
});
