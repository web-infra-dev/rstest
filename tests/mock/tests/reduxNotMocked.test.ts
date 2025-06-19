import { expect, rs, test } from '@rstest/core';
import * as redux from 'redux';

test('mocked redux', async () => {
  const { default: rx } = await rs.importMock<any>('redux');
  await rx.isAction('string');
  expect(rx.isAction).toHaveBeenCalledWith('string');
});

test('actual redux is not mocked', async () => {
  expect(rs.isMockFunction(redux.isAction)).toBe(false);
});
