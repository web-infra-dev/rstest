import { expect, it } from '@rstest/core';
import { classify } from '../src/classify';

it('classifies small and big values', () => {
  expect([1, 2, 3].map(classify)).toEqual(['small', 'small', 'big']);
});
