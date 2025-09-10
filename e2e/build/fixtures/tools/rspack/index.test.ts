import { expect, it } from '@rstest/core';
import { count } from './src/index';

it('tools.rspack config should work correctly', () => {
  expect(count).toBe(2);
});
