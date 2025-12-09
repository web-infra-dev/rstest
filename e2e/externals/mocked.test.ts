import { expect, it, rs } from '@rstest/core';
// @ts-expect-error
import v from 'virtual-module';

rs.mock('virtual-module', () => ({
  default: 'this is a mocked module',
}));

it('should load mocked module', () => {
  expect(v).toBe('this is a mocked module');
});
