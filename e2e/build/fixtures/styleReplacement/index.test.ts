import { expect, it } from '@rstest/core';
import styles from './Button.module.less';
import inlineStyles from './Button.module.less?inline';
import urlStyles from './Button.module.less?url';
import './reset.less';

it('replaces style imports with and without resource queries', () => {
  expect(Reflect.get(Object(styles), 'button')).toBe('button');
  expect(Reflect.get(Object(inlineStyles), 'button')).toBe('button');
  expect(Reflect.get(Object(urlStyles), 'button')).toBe('button');
});
