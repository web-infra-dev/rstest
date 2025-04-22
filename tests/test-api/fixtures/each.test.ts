import { beforeEach, expect, it } from '@rstest/core';

beforeEach(() => {
  console.log('[beforeEach] root');
});

it.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
});
