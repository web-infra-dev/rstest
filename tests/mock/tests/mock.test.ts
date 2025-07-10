import { expect, it, rs } from '@rstest/core';
// @ts-ignore
import { post } from 'axios';
import redux from 'redux';

// To test async mocking factory.
rs.mock('axios', async () => {
  return {
    post: rs.fn(),
  };
});

it('mocked axios', async () => {
  post('string1');
  expect(post).toHaveBeenCalledWith('string1');
});

// manual mock
rs.mock('redux');

it('mocked redux', async () => {
  // const redux = (await import('redux')).default;
  redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
  // @ts-ignore
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
