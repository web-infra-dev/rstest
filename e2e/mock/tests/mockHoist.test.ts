import { expect, it, rs } from '@rstest/core';
// NOTE: '../src/d' MUST imported ahead of '../src/c' to avoid circular dependency
import { d1 } from '../src/d';
// @ts-expect-error
import { c, dd } from '../src/c';

it('mocked c', async () => {
  // @ts-expect-error
  c('c');
  expect(c).toHaveBeenCalledWith('c');
  expect(dd).toBe(1);
});

rs.mock('../src/c', () => {
  return {
    c: rs.fn(),
    dd: d1,
  };
});
