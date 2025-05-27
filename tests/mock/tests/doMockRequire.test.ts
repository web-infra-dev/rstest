import { expect, rs, test } from '@rstest/core';

test('doMockRequire works', () => {
  const { increment: incrementWith1 } = require('../src/increment');
  expect(incrementWith1(1)).toBe(2);

  rs.doMockRequire('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));

  const { increment: incrementWith10 } = require('../src/increment');

  expect(incrementWith10(1)).toBe(11);
});

test('the second doMockRequire can override the first doMockRequire', () => {
  rs.doMockRequire('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));

  const { increment: incrementWith1 } = require('../src/increment');

  expect(incrementWith1(1)).toBe(11);

  rs.doMockRequire('../src/increment', () => ({
    increment: (num: number) => num + 20,
  }));

  const { increment: incrementWith20 } = require('../src/increment');

  expect(incrementWith20(1)).toBe(21);
});
