import { expect, test } from '@rstest/core';
import less from './style.module.less';
import scss from './style.module.scss';
import sass from './style.module.sass';
import globalLess from './global.less';
import globalScss from './global.scss';
import globalSass from './global.sass';

test('unhandled CSS Modules export empty objects', () => {
  expect(less).toEqual({});
  expect(scss).toEqual({});
  expect(sass).toEqual({});
});

test('unhandled global styles export empty strings', () => {
  expect(globalLess).toBe('');
  expect(globalScss).toBe('');
  expect(globalSass).toBe('');
});
