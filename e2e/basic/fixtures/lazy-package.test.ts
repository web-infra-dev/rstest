import { createRequire } from 'node:module';
import { expect, mergeRstestConfig, test } from '@rstest/core';

// Run alone: other test files may already have loaded the package in this worker.
test('loads the package only when a helper is read', () => {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@rstest/core');
  expect(require.cache[entry]).toBeUndefined();
  expect(mergeRstestConfig({ retry: 1 }, { retry: 2 }).retry).toBe(2);
  expect(require.cache[entry]).toBeDefined();
});
