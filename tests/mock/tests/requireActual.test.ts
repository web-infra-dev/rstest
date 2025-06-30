import { expect, it, rs } from '@rstest/core';

const axios = require('axios').default;

rs.mockRequire('axios');

it('mocked axios (axios is externalized)', async () => {
  await axios.get('string');
  expect(axios.get).toHaveBeenCalledWith('string');
  expect(axios.mocked).toBe('axios_mocked');
  expect(axios.post).toBeUndefined();
});

it('use `requireActual` to require actual axios', async () => {
  const originalAxios = await rs.requireActual<typeof axios>('axios');
  expect(rs.isMockFunction(originalAxios.get)).toBe(false);
  expect(originalAxios.mocked).toBeUndefined();
  expect(typeof originalAxios.AxiosHeaders).toBe('function');
});
