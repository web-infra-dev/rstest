import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';

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

  it.skip('it in level A', () => {
    expect(2 + 2).toBe(4);
  });

  it.todo('it in level A', () => {
    expect(2 + 2).toBe(4);
  });

  afterAll(() => {
    console.log('[afterAll] should not run');
  });
});

it.skip('it in level B', () => {
  expect(2 + 2).toBe(4);
});
