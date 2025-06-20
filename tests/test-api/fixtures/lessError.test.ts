import { expect, it } from '@rstest/core';
// @ts-expect-error
import style from './index.module.less';

it('test', () => {
  expect(style).toBeDefined();
});
