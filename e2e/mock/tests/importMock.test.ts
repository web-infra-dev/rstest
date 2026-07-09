import { expect, rs, test } from '@rstest/core';
import * as redux from 'redux';

test('importMock works', async () => {
  const { default: redux } = await rs.importMock<any>('redux');
  await redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
});

test('actual redux is not mocked (ESM)', async () => {
  expect(rs.isMockFunction(redux.isAction)).toBe(false);
});
