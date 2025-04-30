import { describe, expect, it } from '@rstest/core';

describe.skip.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
  });
});

describe.each([
  [2, 1, 3],
  [2, 2, 4],
])('add two numbers correctly', (a, b, expected) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
  });
});
