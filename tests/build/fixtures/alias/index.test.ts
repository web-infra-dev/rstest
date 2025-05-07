import { expect, it } from '@rstest/core';
import { count } from './src/index';

it('Alias config should work correctly', () => {
  expect(count).toBe(2);
});
