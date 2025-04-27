import { expect, it } from '@rstest/core';

it.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add(%i, %i) -> %i', ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
});

it.each([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('add(%i, %i) -> %i', (a, b, expected) => {
  expect(a + b).toBe(expected);
});
