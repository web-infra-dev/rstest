import { expect, it, rs } from '@rstest/core';
import { d } from '../src/d';
import { c, dd } from '../src/c';


rs.mock('../src/c', () => {
  return {
    c: rs.fn(),
    dd: d,
  };
});

it('mocked c', async () => {
  c('c');
  expect(c).toHaveBeenCalledWith('c');
  expect(dd).toBe(4);
});
