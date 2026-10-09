import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

// Not every row is an array, so each row must arrive whole — the array row too.
const mixedTable = [null, 42, ['a']];
const mixedReceived: unknown[] = [];

afterAll(() => {
  expect(logs.length).toBe(8);
  expect(mixedReceived).toEqual(mixedTable);
});

describe.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});

describe.each([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('add two numbers correctly', (a, b, expected) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});

// Template table syntax
describe.each<{ a: number; b: number; expected: number }>`
  a    | b    | expected
  ${1} | ${2} | ${3}
  ${2} | ${3} | ${5}
`('template add $a + $b = $expected', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});

describe.each(mixedTable)('mixed table case %#', (value) => {
  it('should receive the row itself', () => {
    mixedReceived.push(value);
  });
});
