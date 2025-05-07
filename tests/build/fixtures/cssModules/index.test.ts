import { expect, it } from '@rstest/core';
import { style } from './src/index';

it('css modules should work correctly', () => {
  expect(style.titleClass).toBe('index-module__title-class');
});
