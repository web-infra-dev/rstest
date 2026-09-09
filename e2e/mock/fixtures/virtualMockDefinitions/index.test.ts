import { expect, it, rs } from '@rstest/core';
import { value as aliasValue } from 'virtual-alias';
import { value as manualValue } from 'virtual-manual';

rs.mock('virtual-alias', () => ({
  value: 'factory virtual',
}));
rs.mock('virtual-manual');

it('loads a factory mock through resolve.alias', () => {
  expect(aliasValue).toBe('factory virtual');
});

it('loads a manual mock for a non-existent module', () => {
  expect(manualValue).toBe('manual virtual');
});
