// @ts-expect-error
import axiosActual from 'axios?rstest=importActual';
import { expect, it, rs } from '@rstest/core';
import axios from 'axios';
import { b } from '../src/b';
// @ts-expect-error
import { b as bActual } from '../src/b?rstest=importActual';

// #region axios
rs.mock('axios');

it('mocked axios (axios is externalized)', async () => {
  await axios.get('string');
  expect(axios.get).toHaveBeenCalledWith('string');
  // @ts-expect-error
  expect(axios.mocked).toBe('axios_mocked');
  expect(axios.post).toBeUndefined();
});

it('use `importActual` to import actual axios', () => {
  expect(rs.isMockFunction(axiosActual.get)).toBe(false);
  expect(axiosActual.mocked).toBeUndefined();
  expect(typeof axiosActual.AxiosHeaders).toBe('function');
});
// #endregion

// #region ../src/b
rs.mock('../src/b', () => {
  return { b: 'b_mocked' };
});

it('mocked ../src/b', () => {
  expect(b).toBe('b_mocked');
});

it('use `importActual` to import actual ../src/b', () => {
  expect(bActual).toBe(2);
});
// #endregion
