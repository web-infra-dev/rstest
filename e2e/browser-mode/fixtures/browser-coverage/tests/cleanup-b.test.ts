import { expect } from '@rstest/core';
import { cleanupTest } from './cleanupFixture';

cleanupTest('runs the second file', ({ cleanupValue }) => {
  expect(cleanupValue).toBe(true);
});
