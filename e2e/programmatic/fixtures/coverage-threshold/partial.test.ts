import { expect, it } from '@rstest/core';
import { classify } from './src';

// Exercises only the positive branch, so `src.ts` stays below a 100% threshold
// while the test itself passes.
it('covers only the positive branch', () => {
  expect(classify(1)).toBe('positive');
});
