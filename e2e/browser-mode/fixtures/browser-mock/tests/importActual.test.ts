import { expect, it, rs } from '@rstest/core';
import { foo as actualFoo } from '../src/sum' with { rstest: 'importActual' };
import { foo } from '../src/sum';

rs.mock('../src/sum', () => {
  return {
    foo: rs.fn(() => 'mocked-foo'),
    sum: 999,
  };
});

it('plain import is mocked', () => {
  expect(rs.isMockFunction(foo)).toBe(true);
  expect(foo()).toBe('mocked-foo');
});

it('`with { rstest: "importActual" }` keeps the real implementation', () => {
  expect(rs.isMockFunction(actualFoo)).toBe(false);
  expect(actualFoo()).toBe('real-foo');
});

it('rs.importActual returns the original module', async () => {
  const actual =
    await rs.importActual<typeof import('../src/sum')>('../src/sum');
  expect(rs.isMockFunction(actual.foo)).toBe(false);
  expect(actual.foo()).toBe('real-foo');
  expect(actual.sum).toBe(3);
});
