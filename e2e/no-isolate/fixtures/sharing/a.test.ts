import { expect, test } from '@rstest/core';
import { getSharedEvalId } from './shared';

test('a: statically imported module is shared across files', () => {
  expect(getSharedEvalId()).toBe(1);
});

test('a: dynamically imported module is shared across files', async () => {
  const { getDynEvalId } = await import('./dynShared');
  expect(getDynEvalId()).toBe(1);
});

test('a: setup re-ran for this file', () => {
  expect((globalThis as Record<string, any>).__rstestSetupFor).toContain(
    'a.test',
  );
});
