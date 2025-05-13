import { it } from '@rstest/core';

it.for([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add($a, $b) -> $expected', ({ a, b, expected }, { expect }) => {
  expect(a + b).toBe(expected);
});

it.for([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('case-%# add(%i, %i) -> %i', ([a, b, expected], { expect }) => {
  expect(a + b).toBe(expected);
});
