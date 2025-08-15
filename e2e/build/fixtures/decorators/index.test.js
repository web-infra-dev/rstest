import { expect, it } from '@rstest/core';
import './src/index';

it('decorator should work correctly', () => {
  expect(global.ccc).toBe('hello world');
  expect(global.aaa).toBe('hello');
  expect(global.bbb).toBe('world');
});
