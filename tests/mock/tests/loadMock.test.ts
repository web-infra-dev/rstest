import { expect, rs, test } from '@rstest/core';
import * as redux from 'redux';

test('importMock works', async () => {
  const { default: rx } = await rs.importMock<any>('redux');
  await rx.isAction('string');
  expect(rx.isAction).toHaveBeenCalledWith('string');
});

test('actual redux is not mocked (ESM)', async () => {
  expect(rs.isMockFunction(redux.isAction)).toBe(false);
});

// test('requireMock works', async () => {
//   const rx = rs.requireMock<any>('redux');
//   console.log('💂‍♂️', rx);
//   await rx.isAction('string');
//   expect(rx.isAction).toHaveBeenCalledWith('string');
// });

// test('actual redux is not mocked (CJS)', async () => {
//   const rx = require('redux');
//   expect(rs.isMockFunction(rx.isAction)).toBe(false);
// });
