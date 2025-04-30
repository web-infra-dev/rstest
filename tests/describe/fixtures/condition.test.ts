import { describe, expect, it } from '@rstest/core';

describe.skipIf(1 + 1 === 2).each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  it(`should return ${expected}`, () => {
    expect(a + b).toBe(expected);
  });
});

describe.runIf(1 + 1 === 2)('add two numbers correctly', () => {
  it('add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
