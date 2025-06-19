import { expect, rs, test } from '@rstest/core';
import * as redux from 'redux';

// importMock
test('mocked redux', async () => {
  const { default: rx } = await rs.importMock<any>('redux');
  await rx.isAction('string');
  expect(rx.isAction).toHaveBeenCalledWith('string');
});

test('actual redux is not mocked', async () => {
  expect(rs.isMockFunction(redux.isAction)).toBe(false);
});

// requireMock
test('mocked redux (CJS)', async () => {
  const rx = rs.requireMock<any>('redux').default;
  await rx.isAction('string');
  expect(rx.isAction).toHaveBeenCalledWith('string');
});

test('actual redux is not mocked (CJS)', async () => {
  const rx = require('redux');
  expect(rs.isMockFunction(rx.isAction)).toBe(false);
});
