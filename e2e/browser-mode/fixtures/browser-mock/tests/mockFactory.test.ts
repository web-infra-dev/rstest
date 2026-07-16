import { expect, it, rs } from '@rstest/core';
import { foo, sum } from '../src/sum';

// The mock must be hoisted above the static import, so the imported bindings
// are already replaced when this module evaluates.
rs.mock('../src/sum', () => {
  return {
    foo: rs.fn(() => 'mocked-foo'),
    sum: 999,
  };
});

it('applies a factory mock to statically imported bindings', () => {
  expect(rs.isMockFunction(foo)).toBe(true);
  expect(foo()).toBe('mocked-foo');
  expect(sum).toBe(999);
});
