import { expect, it, rs } from '@rstest/core';
import * as originalAxios from 'axios' with { rstest: 'importActual' };
import * as axios from 'axios';
import redux from 'redux';
import { d1, d2 } from '../src/d' with { rstest: 'importActual' };
import { d3 } from '../src/d';

// To test async mocking factory.
rs.mock('../src/d', () => {
  return {
    d1,
    d2,
    d3: rs.fn(),
  };
});

it('mocked d', () => {
  // @ts-expect-error: It has been mocked.
  d3('string1');
  expect(d3).toHaveBeenCalledWith('string1');
  expect(d1).toBe(1);
  expect(d2).toBe(2);
});

// manual mock
rs.mock('redux');

it('mocked redux', () => {
  redux.isAction('string');
  expect(redux.isAction).toHaveBeenCalledWith('string');
  // @ts-expect-error: It has been mocked.
  expect(redux.mocked).toBe('redux_yes');
});

// mock factory
rs.mock('axios', () => {
  // partial mock
  return {
    ...originalAxios,
    aaa: rs.fn(),
  };
});

it('mocked axios', async () => {
  // @ts-expect-error
  expect(rs.isMockFunction(axios.aaa)).toBe(true);
  // @ts-expect-error
  expect(rs.isMockFunction(axios.bbb)).toBe(false);
  // @ts-expect-error
  expect(originalAxios.aaa).toBeUndefined();
  // @ts-expect-error
  expect(originalAxios.bbb).toBeUndefined();

  expect(originalAxios.Axios).toBeDefined();

  if (process.env.RSTEST_OUTPUT_MODULE !== 'false') {
    expect(axios.Axios).toBeDefined();
  }
});
