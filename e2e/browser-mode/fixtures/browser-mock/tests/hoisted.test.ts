import { expect, it, rs } from '@rstest/core';
import { foo } from '../src/sum';

// `rs` must be reachable inside the hoisted callback even though the block is
// moved above the imports (mirrors e2e/mock/tests/hoisted.test.ts).
const mocks = rs.hoisted(() => {
  return {
    hoistedFn: rs.fn(),
  };
});

rs.mock('../src/sum', () => {
  return { foo: mocks.hoistedFn };
});

it('rs.hoisted values are usable from the mock factory', () => {
  mocks.hoistedFn(42);
  expect(mocks.hoistedFn).toHaveBeenCalledOnce();
  expect(mocks.hoistedFn).toHaveBeenCalledWith(42);
  expect(foo).toBe(mocks.hoistedFn);
});
