import { expect, it, rs } from '@rstest/core';
import redux from 'redux';
import { sleep } from '../../scripts/utils';
import { d } from '../src/d';

// To test async mocking factory.
rs.mock('../src/d', async () => {
  await sleep(1000);
  return {
    d: rs.fn(),
  };
});

it('mocked d', async () => {
  // @ts-expect-error: It has been mocked.
  d('string1');
  expect(d).toHaveBeenCalledWith('string1');
});

// manual mock
rs.mock('redux');

it('mocked redux', async () => {
  redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
  // @ts-expect-error: It has been mocked.
  expect(redux.mocked).toBe('redux_yes');
});

// mock factory
rs.mock('axios', async () => {
  const originalAxios = await rs.importActual('axios');
  return {
    ...originalAxios,
    post: rs.fn(),
  };
});

it('mocked axios', async () => {
  const axios = await import('axios');
  // @ts-expect-error
  expect(rs.isMockFunction(axios.post)).toBe(true);
  // @ts-expect-error
  expect(rs.isMockFunction(axios.get)).toBe(false);
});
