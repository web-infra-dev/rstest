import { expect, it, rs } from '@rstest/core';
// @ts-expect-error virtual module is provided by rs.mock
import value from 'virtual-module';

rs.mock('virtual-module', () => ({
  default: 'mocked-virtual-module',
}));

it('should keep virtual module mocks working after build cache warm runs', () => {
  expect(value).toBe('mocked-virtual-module');
});
