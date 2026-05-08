import { expect, it } from '@rstest/core';
import { product, sum } from './src/math';

it('happy-dom build cache fixture runs', () => {
  expect(sum([1, 2, 3, 4, 5])).toBe(15);
  expect(product([1, 2, 3, 4])).toBe(24);
});
