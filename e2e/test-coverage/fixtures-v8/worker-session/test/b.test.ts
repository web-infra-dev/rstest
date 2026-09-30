import { expect, it } from '@rstest/core';
import { classify } from '../src/classify';

it('classifies big values', () => {
  expect([4, 5].map(classify)).toEqual(['big', 'big']);
});
