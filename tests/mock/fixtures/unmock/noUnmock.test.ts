import { randomFill } from 'node:crypto';
import { expect, it } from '@rstest/core';

it('should run setup file correctly', () => {
  expect(randomFill).toBe('mocked_randomFill');
});
