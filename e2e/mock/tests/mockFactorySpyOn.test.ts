import { expect, it, rs } from '@rstest/core';
import * as ns from '../src/increment';

// Regression for https://github.com/web-infra-dev/rstest/issues/1923
rs.mock('../src/increment', () => ({
  ...rs.requireActual<typeof import('../src/increment')>('../src/increment'),
}));

it('spies on and restores an export of a factory-mocked module', () => {
  const spy = rs.spyOn(ns, 'increment').mockReturnValue(0);
  expect(ns.increment(1)).toBe(0);

  spy.mockRestore();
  expect(ns.increment(1)).toBe(2);
});
