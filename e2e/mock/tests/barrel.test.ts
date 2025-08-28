import { expect, it, rs } from '@rstest/core';
import * as barMod from '../src/bar';
import { sum } from '../src/sum';

rs.mock('../src/foo', async () => {
  return { foo: barMod.bar };
});

it('sum', () => {
  expect(sum).toBe('bar1');
});
