import { afterAll, expect, it, rs } from '@rstest/core';

rs.doMockRequire('../src/sideEffects', () => {
  return {
    a: 2,
  };
});

afterAll(() => {
  rs.doUnmock('../src/sideEffects');
});

it('mocked a with doMockRequire', () => {
  const { a } = require('../src/sideEffects');
  expect(a).toBe(2);
  expect(process.env.a).toBeUndefined();
});
