import { expect, it, rs } from '@rstest/core';

// TODO: static import with mockFactory, any other imported module in mockFactory
// will throw an reference error as it hoisted to the top of the module.
// import r from 'redux';

// manual mock
rs.mock('redux');

it('mocked redux', async () => {
  const redux = (await import('redux')).default;
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
