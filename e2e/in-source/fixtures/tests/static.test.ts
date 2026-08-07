import { expect, it } from '@rstest/core';
import { getEvaluationCount, sayHi } from '../src';

it('statically imports an in-source test module', () => {
  expect(import.meta.rstest).toBeDefined();
  expect(sayHi()).toBe('hi');
  expect(getEvaluationCount()).toBeLessThanOrEqual(2);
});
