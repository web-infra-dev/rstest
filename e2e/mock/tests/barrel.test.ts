import { expect, it, rs } from '@rstest/core';
import { baz } from '../src/baz';
import { sum } from '../src/sum';

rs.mock('../src/foo', () => {
  return { foo: baz };
});

it('sum', () => {
  expect(sum).toBe('bazbar');
});
