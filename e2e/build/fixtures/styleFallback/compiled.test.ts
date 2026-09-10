import { expect, test } from '@rstest/core';
import less from './style.module.less';
import scss from './style.module.scss';
import sass from './style.module.sass';

test('preprocessor plugins and CSS Modules options remain effective', () => {
  expect(less.loading).toBe('configured_loading');
  expect(scss.loading).toBe('configured_loading');
  expect(sass.loading).toBe('configured_loading');
});
