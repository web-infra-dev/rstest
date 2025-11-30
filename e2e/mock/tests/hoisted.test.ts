import { expect, it, rs } from '@rstest/core';
import { foo } from '../src/sum';

// `rs` should can be accessed in hoisted function.
const mocks = rs.hoisted(() => {
  return {
    hoistedFn: rs.fn(),
  };
});

rs.mock('../src/sum', () => {
  return { foo: mocks.hoistedFn };
});

it('hoisted', () => {
  mocks.hoistedFn(42);
  expect(mocks.hoistedFn).toHaveBeenCalledOnce();
  expect(mocks.hoistedFn).toHaveBeenCalledWith(42);
  expect(foo).toBe(mocks.hoistedFn);
});
