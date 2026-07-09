import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs.length).toBe(8);
});

describe.for([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});

describe.for([
  [2, 1, 3],
  [2, 2, 4],
  [3, 1, 4],
])('add two numbers correctly', ([a, b, expected]) => {
  it(`should return ${expected}`, () => {
    expect(a! + b!).toBe(expected);
    logs.push('executed');
  });
});

// Template table syntax
describe.for<{ a: number; b: number; expected: number }>`
  a    | b    | expected
  ${1} | ${2} | ${3}
  ${2} | ${3} | ${5}
`('template for $a + $b = $expected', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
    logs.push('executed');
  });
});
