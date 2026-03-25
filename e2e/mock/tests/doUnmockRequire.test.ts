import { expect, rs, test } from '@rstest/core';

test('doUnmockRequire restores the original CommonJS module', () => {
  rs.doMockRequire('../src/increment', () => ({
    increment: (num: number) => num + 100,
  }));

  const { increment: mockedIncrement } = require('../src/increment');
  expect(mockedIncrement(1)).toBe(101);

  rs.doUnmockRequire('../src/increment');

  const { increment } = require('../src/increment');
  expect(increment(1)).toBe(2);
});
