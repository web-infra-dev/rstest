import { afterAll, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs.length).toBe(9);
});

it.for([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add($a, $b) -> $expected', ({ a, b, expected }, { expect }) => {
  expect(a + b).toBe(expected);
  logs.push('executed');
});

it.for([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('case-%# add(%i, %i) -> %i', ([a, b, expected], { expect }) => {
  expect(a! + b!).toBe(expected);
  logs.push('executed');
});

// Template table syntax
it.for<{ a: number; b: number; expected: number }>`
  a    | b    | expected
  ${1} | ${2} | ${3}
  ${2} | ${3} | ${5}
  ${4} | ${5} | ${9}
`('template for add($a, $b) -> $expected', ({ a, b, expected }, { expect }) => {
  expect(a + b).toBe(expected);
  logs.push('executed');
});
