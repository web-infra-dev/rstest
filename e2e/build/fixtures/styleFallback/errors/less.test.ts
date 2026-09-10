import { expect, test } from '@rstest/core';
import style from '../style.module.less';

test('undefined Less variable must fail compilation', () => {
  expect(style).toBeDefined();
});
