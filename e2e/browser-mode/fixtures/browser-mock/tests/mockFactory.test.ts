import { expect, it, rs } from '@rstest/core';
import * as incrementModule from '../src/increment';
import { foo, sum } from '../src/sum';

// The mock must be hoisted above the static import, so the imported bindings
// are already replaced when this module evaluates.
rs.mock('../src/sum', () => {
  return {
    foo: rs.fn(() => 'mocked-foo'),
    sum: 999,
  };
});

rs.mock('../src/increment', () => ({
  increment: (num: number) => num + 100,
}));

it('applies a factory mock to statically imported bindings', () => {
  expect(rs.isMockFunction(foo)).toBe(true);
  expect(foo()).toBe('mocked-foo');
  expect(sum).toBe(999);
});

it('spies on a plain factory export and restores the factory implementation', () => {
  const original = incrementModule.increment;
  expect(rs.isMockFunction(original)).toBe(false);

  const spy = rs.spyOn(incrementModule, 'increment').mockReturnValue(42);
  expect(incrementModule.increment(1)).toBe(42);
  expect(spy).toHaveBeenCalledWith(1);

  spy.mockRestore();
  expect(incrementModule.increment).toBe(original);
  expect(incrementModule.increment(1)).toBe(101);
});
