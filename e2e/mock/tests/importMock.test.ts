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

test('dynamic importMock uses a registered factory for a relative module', async () => {
  rs.doMock('../src/foo', () => ({
    foo: 'MOCKED_RELATIVE',
  }));

  const request = '../src/foo';
  const mocked = await rs.importMock<typeof import('../src/foo')>(request);

  expect(mocked.foo).toBe('MOCKED_RELATIVE');
});

test('static importMock uses the registered factory for an ESM imported rs', async () => {
  rs.mock('../src/sum', () => ({
    foo: 'STATIC_FACTORY',
    sum: 100,
  }));

  const mocked = await rs.importMock<typeof import('../src/sum')>('../src/sum');

  expect(mocked.foo).toBe('STATIC_FACTORY');
  expect(mocked.sum).toBe(100);
});

test('importMock uses a CommonJS manual mock', async () => {
  const redux = await rs.importMock<any>('redux-cjs');

  redux.isAction('string');
  expect(rs.isMockFunction(redux.isAction)).toBe(true);
  expect(redux.isAction).toHaveBeenCalledWith('string');
  expect(redux.mocked).toBe('redux_yes');
});

test('importMock reports an unknown runtime request', async () => {
  const request = '../src/not-in-bundle';

  await expect(rs.importMock(request)).rejects.toThrow(
    /\[Rstest\] Cannot find module "\.\.\/src\/not-in-bundle"/,
  );
});
