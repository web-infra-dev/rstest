import { expect, it, rs } from '@rstest/core';
import { readVirtualValue } from '../src/virtualConsumer';
// @ts-expect-error The module is supplied by the mock factory at runtime.
import virtualDefault, { namedValue } from './virtual-esm';

rs.mock('virtual-dependency', () => ({
  value: 'virtual dependency',
}));

rs.mock('./virtual-esm', () => ({
  default: 'virtual default',
  namedValue: 'virtual named',
}));

rs.mockRequire('./virtual-cjs', () => ({
  value: 'virtual require',
}));

it('mocks a non-existent relative module for static imports', () => {
  expect(virtualDefault).toBe('virtual default');
  expect(namedValue).toBe('virtual named');
});

it('mocks a non-existent dependency imported by source code', () => {
  expect(readVirtualValue()).toBe('virtual dependency');
});

it('mocks a non-existent relative module for dynamic imports', async () => {
  rs.doMock('./virtual-dynamic', () => ({
    value: 'virtual dynamic',
  }));

  // @ts-expect-error The module is supplied by the mock factory at runtime.
  const { value } = await import('./virtual-dynamic');

  expect(value).toBe('virtual dynamic');
});

it('mocks a non-existent relative module for require', () => {
  const { value } = require('./virtual-cjs');

  expect(value).toBe('virtual require');
});

it('mocks a non-existent relative module for a later require', () => {
  rs.doMockRequire('./virtual-dynamic-cjs', () => ({
    value: 'virtual dynamic require',
  }));

  const { value } = require('./virtual-dynamic-cjs');

  expect(value).toBe('virtual dynamic require');
});
