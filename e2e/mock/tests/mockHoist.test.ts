import { expect, it, rs } from '@rstest/core';
import { c } from '../src/c';
import { d } from '../src/d';

rs.mock('../src/c', () => {
  return {
    c: rs.fn(),
    d,
  };
});

it('mocked c', async () => {
  // @ts-expect-error: It has been mocked.
  c('c');
  expect(c).toHaveBeenCalledWith('c');
  expect(d).toBe(4);
});
