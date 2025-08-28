/** biome-ignore-all assist/source/organizeImports: ../src/c should come after ../src/d */

import { expect, it, rs } from '@rstest/core';
import { d } from '../src/d';
// @ts-expect-error it's has been mocked
import { c, dd } from '../src/c';

rs.mock('../src/c', () => {
  return {
    c: rs.fn(),
    dd: d,
  };
});

it('mocked c', async () => {
  // @ts-expect-error it's has been mocked
  c('c');
  expect(c).toHaveBeenCalledWith('c');
  expect(dd).toBe(4);
});
