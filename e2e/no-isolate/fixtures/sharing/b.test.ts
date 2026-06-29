import { expect, test } from '@rstest/core';
import { getSharedEvalId } from './shared';

test('b: statically imported module is shared across files', () => {
  expect(getSharedEvalId()).toBe(1);
});

test('b: dynamically imported module is shared across files', async () => {
  const { getDynEvalId } = await import('./dynShared');
  expect(getDynEvalId()).toBe(1);
});

test('b: setup re-ran for this file', () => {
  expect((globalThis as Record<string, any>).__rstestSetupFor).toContain(
    'b.test',
  );
});
