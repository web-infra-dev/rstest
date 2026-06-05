import { expect, test } from '@rstest/core';

test('browser build cache fixture runs', () => {
  expect('rstest'.toUpperCase()).toBe('RSTEST');
});
