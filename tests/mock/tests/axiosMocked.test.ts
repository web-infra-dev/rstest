import { expect, it, rs } from '@rstest/core';
// @ts-ignore
import axios from 'axios';

rs.mock('axios');

it('mocked axios', async () => {
  await axios.get('string');
  expect(axios.get).toHaveBeenCalledWith('string');
  expect(axios.post).toBeUndefined();
});
