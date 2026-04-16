import { afterAll, expect, it, rs } from '@rstest/core';
import { a } from '../src/sideEffects';

rs.mock('../src/sideEffects', () => {
  return {
    a: 2,
  };
});

afterAll(() => {
  rs.doUnmock('../src/sideEffects');
});

it('mocked a', () => {
  expect(a).toBe(2);
  expect(process.env.a).toBeUndefined();
});
