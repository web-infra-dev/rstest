import { expect, it, rs } from '@rstest/core';
import axios from 'axios';

rs.mock('axios');

it('mocked axios (axios is externalized)', async () => {
  await axios.get('string');
  expect(axios.get).toHaveBeenCalledWith('string');
  // @ts-expect-error
  expect(axios.mocked).toBe('axios_mocked');
  expect(axios.post).toBeUndefined();
});

it('use `importActual` to import actual axios', async () => {
  const ax = await rs.importActual<typeof axios>('axios');
  expect(rs.isMockFunction(ax.get)).toBe(false);
  // @ts-expect-error
  expect(ax.mocked).toBeUndefined();
  expect(typeof ax.AxiosHeaders).toBe('function');
});
