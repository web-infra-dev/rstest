import { expect, it } from '@rstest/core';

it('dynamically imports an in-source test module', async () => {
  expect(import.meta.rstest).toBeDefined();
  const { getEvaluationCount, sayHi } = await import('../src');
  expect(sayHi()).toBe('hi');
  expect(getEvaluationCount()).toBeLessThanOrEqual(2);
});
