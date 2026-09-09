import { expect, it, rs } from '@rstest/core';
import { value } from 'virtual-browser-module';

rs.mock('virtual-browser-module', () => ({
  value: 'virtual browser',
}));

it('loads the virtual module', () => {
  expect(value).toBe('virtual browser');
});
