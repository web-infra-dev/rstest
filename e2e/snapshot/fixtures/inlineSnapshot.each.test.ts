import { describe, expect, it } from '@rstest/core';

describe('test inlineSnapshot in each', () => {
  it.each([
    { a: 1, b: 2 },
    { a: 2, b: 1 },
  ])('add two numbers correctly', ({ a, b }) => {
    expect(a + b).toMatchInlineSnapshot('3');
  });
});

describe.each([
  { a: 1, b: 1, expected: 2 },
  { a: 1, b: 2, expected: 3 },
  { a: 2, b: 1, expected: 3 },
])('add two numbers correctly', ({ a, b, expected }) => {
  it(`${a} + ${b} should return ${expected}`, () => {
    expect(a + b).toMatchInlineSnapshot('2');
  });
});
