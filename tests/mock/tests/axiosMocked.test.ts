import { expect, it, rs } from '@rstest/core';
import axios from 'axios';

rs.mock('axios');

it('mocked axios', async () => {
  await axios.get('string');
  expect(axios.get).toHaveBeenCalledWith('string');
  // @ts-ignore
  expect(axios.mocked).toBe('axios_yes');
  expect(axios.post).toBeUndefined();
});

it('can get actual axios', async () => {
  const ax = await rs.importActual<typeof axios>('axios');
  expect(rs.isMockFunction(ax.get)).toBe(false);
  // @ts-ignore
  expect(ax.mocked).toBeUndefined();
  expect(typeof ax.AxiosHeaders).toBe('function');
});
