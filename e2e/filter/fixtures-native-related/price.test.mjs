import { expect, it } from '@rstest/core';

it('reads the native price provider', () => {
  expect(require('./native/provider.cjs')).toBe(42);
});
