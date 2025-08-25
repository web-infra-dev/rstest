import { expect, it, rs } from '@rstest/core';

rs.mockRequire('redux');

it('mocked redux', () => {
  const redux = require('redux').default;
  redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
  expect(redux.mocked).toBe('redux_yes');
});
