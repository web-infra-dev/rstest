import { expect, it } from '@rstest/core';
import { count } from './src/index';

it('Rsbuild plugin should work correctly', () => {
  expect(count).toBe(2);
});
