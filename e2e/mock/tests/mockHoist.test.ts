import { foo } from '../src/foo';
// NOTE: '../src/d' MUST imported ahead of '../src/c' to avoid circular dependency
import { d1 } from '../src/d';
// @ts-expect-error
import { c, dd } from '../src/c';
import { expect, it, rs } from '@rstest/core';

rs.mock('../src/foo', () => {
  return {
    foo: rs.fn(),
  };
});

it('@rstest/core should be accessible even if it is imported late, it is specifically hoisted', async () => {
  // @ts-expect-error
  foo('a', 'b');
  expect(foo).toHaveBeenCalledWith('a', 'b');
});

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
