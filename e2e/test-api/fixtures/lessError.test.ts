import { expect, it } from '@rstest/core';
import style from './index.module.less?raw';

it('test', () => {
  expect(style).toBeDefined();
});
