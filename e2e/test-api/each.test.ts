import { afterAll, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs.length).toBe(13);
});

it.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add($a, $b) -> $expected', ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
  logs.push('executed');
});

it.each([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('case-%# add(%i, %i) -> %i', (a, b, expected) => {
  expect(a + b).toBe(expected);
  logs.push('executed');
});

it.each([1, 2, 3])('test number %i', (a) => {
  expect(a).toBeTypeOf('number');
});

// Template table syntax
it.each<{ a: number; b: number; expected: number }>`
  a    | b    | expected
  ${1} | ${2} | ${3}
  ${2} | ${3} | ${5}
`('template add($a, $b) -> $expected', ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
  logs.push('executed');
});

it.each<{ input: string; expected: number }>`
  input       | expected
  ${'hello'}  | ${5}
  ${'world!'} | ${6}
  ${''}       | ${0}
`('template string length $input -> $expected', ({ input, expected }) => {
  expect(input.length).toBe(expected);
  logs.push('executed');
});

it.each`
  value
  ${true}
  ${false}
`('template single column $value', ({ value }) => {
  expect(typeof value).toBe('boolean');
  logs.push('executed');
});
