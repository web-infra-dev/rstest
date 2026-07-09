import { randomFill } from 'node:crypto';
import { expect, it } from '@rstest/core';
import { a } from './a';

it('should run setup file correctly', () => {
  expect(a).toBe(2);
  expect(randomFill).toBe('mocked_randomFill');
});
