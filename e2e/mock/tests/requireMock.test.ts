import { expect, rs, test } from '@rstest/core';

test('requireMock works', async () => {
  const redux = rs.requireMock<any>('redux-cjs');
  await redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
});

test('dynamic requireMock uses a registered factory for a relative module', () => {
  rs.doMock('../src/foo', () => ({
    foo: 'MOCKED_RELATIVE',
  }));

  const request = '../src/foo';
  const mocked = rs.requireMock<typeof import('../src/foo')>(request);

  expect(mocked.foo).toBe('MOCKED_RELATIVE');
});

test('actual redux is not mocked (CJS)', async () => {
  const redux = require('redux');
  expect(rs.isMockFunction(redux.isAction)).toBe(false);
});
