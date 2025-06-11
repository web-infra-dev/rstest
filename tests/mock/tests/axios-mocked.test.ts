import { expect, it, rs } from '@rstest/core';
// @ts-ignore
import axios from 'axios';

rs.mock('axios');

it('mocked axios', async () => {
  await axios.get('string');

  expect(axios.get).toHaveBeenCalledWith('string');
  expect(axios.post).toBeUndefined();
});

// test('can get actual axios', async () => {
//   const ax = await vi.importActual<typeof axios>('axios');

//   expect(vi.isMockFunction(ax.get)).toBe(false);
// });
