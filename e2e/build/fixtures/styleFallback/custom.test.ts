import { expect, test } from '@rstest/core';
import alias from 'aliased.less';
import raw from './global.less?raw';
import custom from './global.less';
import source from './global.scss';
import empty from './global.sass';

test('user rules and aliases take priority per resource', () => {
  expect(alias).toBe('alias-value');
  expect(raw).toContain('.loading');
  expect(source).toContain('.loading');
  expect(custom).toBe('custom-value');
  expect(empty).toBe('');
});
