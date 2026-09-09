import { expect } from '@rstest/core';
import { cleanupTest } from './cleanupFixture';

cleanupTest('runs the first file', ({ cleanupValue }) => {
  expect(cleanupValue).toBe(true);
});
