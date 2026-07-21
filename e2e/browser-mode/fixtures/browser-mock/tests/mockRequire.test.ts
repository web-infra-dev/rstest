import { expect, it, rs } from '@rstest/core';

rs.mockRequire('../src/mathCjs.cjs', () => {
  return {
    multiply: rs.fn(() => 42),
  };
});

it('mockRequire replaces the required CJS module', () => {
  const math = require('../src/mathCjs.cjs');
  expect(math.multiply(2, 3)).toBe(42);
  expect(rs.isMockFunction(math.multiply)).toBe(true);
});
