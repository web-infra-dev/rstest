import { expect, it } from '@rstest/core';
import { double } from '../src/math';

it('runs regular test files alongside in-source ones', () => {
  expect(double(2)).toBe(4);
});
