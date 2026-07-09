import { expect, test } from '@rstest/core';

/**
 * Keeps a second test file ahead of the locator-based file so headed mode exercises
 * multi-file scheduling instead of the single-file happy path.
 */
test('headed concurrency smoke', () => {
  expect(1).toBe(1);
});
