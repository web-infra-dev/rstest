import { expect, it, rs } from '@rstest/core';
import axiosActual from 'axios' with { rstest: 'importActual' };
import axios from 'axios';
import { b as bActual } from '../src/b' with { rstest: 'importActual' };
import { b } from '../src/b';

// #region axios
rs.mock('axios');

it('mocked axios (axios is externalized)', async () => {
  await axios.get('string');
  expect(axios.get).toHaveBeenCalledWith('string');
  // @ts-expect-error
  expect(axios.mocked).toBe('axios_mocked');
  expect(axios.post).toBeUndefined();
});

it('use `importActual` attributes to import actual axios', () => {
  expect(rs.isMockFunction(axiosActual.get)).toBe(false);
  // @ts-expect-error
  expect(axiosActual.mocked).toBeUndefined();
  expect(typeof axiosActual.AxiosHeaders).toBe('function');
});

it('use `rs.importActual` to import actual axios', async () => {
  const axiosRsActual = await rs.importActual<typeof axios>('axios');
  expect(rs.isMockFunction(axiosRsActual.get)).toBe(false);
  // @ts-expect-error
  expect(axiosRsActual.mocked).toBeUndefined();
  expect(typeof axiosRsActual.AxiosHeaders).toBe('function');
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

it('use `rs.importActual` to import actual ../src/b', async () => {
  const { b: bRsActual } =
    await rs.importActual<typeof import('../src/b')>('../src/b');
  expect(bRsActual).toBe(2);
});
// #endregion
