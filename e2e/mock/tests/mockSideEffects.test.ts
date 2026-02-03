import { expect, it, rs } from '@rstest/core';
import { a } from '../src/sideEffects';

rs.mock('../src/sideEffects', () => {
  return {
    a: 2,
  };
});

it('mocked a', () => {
  expect(a).toBe(2);
  expect(process.env.a).toBeUndefined();
});
