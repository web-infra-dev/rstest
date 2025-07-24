import { expect, it, rs } from '@rstest/core';
import { d } from '../src/d';
import { c, dd } from '../src/c';

rs.mock('../src/c',  () => {
  return {
    c: rs.fn(),
    dd: d,
  };
});

it('mocked c', async () => {
  // console.log('🧝', c, dd)
  // @ts-expect-error: It has been mocked.
  c('c');
  expect(c).toHaveBeenCalledWith('c');
  expect(dd).toBe(4);
});
