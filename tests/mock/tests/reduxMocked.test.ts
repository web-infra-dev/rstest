import { expect, it, rs } from '@rstest/core';
import redux from 'redux';

rs.mock('redux');

it('mocked redux', async () => {
  await redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
  // @ts-ignore
  expect(redux.mocked).toBe('redux_yes');
});

it('importActual works', async () => {
  const rx = await rs.importActual<typeof redux>('redux');
  expect(rs.isMockFunction(rx.isAction)).toBe(false);
  expect(typeof rx.applyMiddleware).toBe('function');
});

it('requireActual and importActual works together', async () => {
  // const rxEsm = await rs.importActual<typeof redux>('redux');
  const rxCjs = rs.requireActual<typeof redux>('redux');
  expect(rs.isMockFunction(rxCjs.isAction)).toBe(false);
  expect(typeof rxCjs.applyMiddleware).toBe('function');
  expect(redux.compose).not.toBe(rxCjs.compose);
});
