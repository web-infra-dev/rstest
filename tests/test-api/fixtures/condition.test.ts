import { expect, it } from '@rstest/core';

it.skipIf(1 + 1 === 2).each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add($a, $b) -> $expected', ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
});

it.runIf(1 + 1 === 2)('add two numbers correctly', () => {
  expect(1 + 1).toBe(2);
});
