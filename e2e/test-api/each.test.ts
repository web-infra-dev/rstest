import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

// Not every row is an array, so each row must arrive whole — the array row too.
const mixedTable = [null, 42, ['a']];
const mixedReceived: unknown[] = [];

afterAll(() => {
  expect(logs.length).toBe(17);
  expect(mixedReceived).toEqual(mixedTable);
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

it.each([{ value: null }])('nullable $value', () => {
  expect(expect.getState().currentTestName).toBe('nullable null');
  logs.push('executed');
});

// `%s`, `%o` and `%O` print an object like `util.format`, not `[object Object]`.
it.each([[{ a: 1 }, ['x', 2]]])('object %o and array %O', () => {
  expect(expect.getState().currentTestName).toBe(
    "object { a: 1 } and array [ 'x', 2 ]",
  );
  logs.push('executed');
});

it.each([{ a: { b: 1 } }])('row %s', () => {
  expect(expect.getState().currentTestName).toBe('row { a: { b: 1 } }');
  logs.push('executed');
});

describe.each([[{ id: 1 }]])('suite %o', () => {
  it('uses the formatted suite name', () => {
    expect(expect.getState().currentTestName).toBe(
      'suite { id: 1 } > uses the formatted suite name',
    );
    logs.push('executed');
  });
});

it.each(mixedTable)('mixed table case %#', (value) => {
  mixedReceived.push(value);
});
