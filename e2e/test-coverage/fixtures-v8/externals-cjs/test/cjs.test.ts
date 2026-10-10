import { expect, it } from '@rstest/core';
import { double } from '../src/bom.cjs';
import { classify } from '../src/hashbang.cjs';

it('runs CommonJS sources that start with a hashbang', () => {
  expect([0, 1, 3].map(classify)).toEqual(['none', 'small', 'big']);
  expect([1, 3].map(double)).toEqual([1, 6]);
});
