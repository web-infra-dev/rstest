import { expect, rs, test } from '@rstest/core';

test('doMockRequire works', async () => {
  const { increment: incrementWith1 } = require('../src/increment');
  expect(incrementWith1(1)).toBe(2);

  rs.doMockRequire('../src/increment', () => ({
    increment: (num: number) => num + 10,
  }));

  rs.requireActual('../src/increment'); // Ensure the module is re-evaluated

  const { increment: incrementWith10 } = require('../src/increment');
  expect(incrementWith10(1)).toBe(11);
});

test('the second doMockRequire can override the first doMockRequire', async () => {
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

test('the third doMockRequire can override the second doMockRequire', async () => {
  rs.doMockRequire('../src/increment', () => {
    return {
      increment: (num: number) => num + 100,
    };
  });

  const { increment: incrementWith1 } = require('../src/increment');

  expect(incrementWith1(1)).toBe(101);

  rs.doMockRequire('../src/increment', () => {
    return {
      increment: (num: number) => num + 200,
    };
  });

  const { increment: incrementWith20 } = require('../src/increment');

  expect(incrementWith20(1)).toBe(201);
});
