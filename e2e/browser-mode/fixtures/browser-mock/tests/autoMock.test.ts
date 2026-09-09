import { expect, it, rs } from '@rstest/core';
import { increment } from '../src/increment';

rs.mock('../src/increment', { mock: true });

it('automock replaces exports with mock functions', () => {
  expect(rs.isMockFunction(increment)).toBe(true);
  expect(increment(5)).toBeUndefined();
  expect(increment).toHaveBeenCalledWith(5);
});
