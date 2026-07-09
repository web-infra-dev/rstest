import { expect, rs, test } from '@rstest/core';

test('requireMock works', async () => {
  const redux = rs.requireMock<any>('redux-cjs');
  await redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
});

test('actual redux is not mocked (CJS)', async () => {
  const redux = require('redux');
  expect(rs.isMockFunction(redux.isAction)).toBe(false);
});
