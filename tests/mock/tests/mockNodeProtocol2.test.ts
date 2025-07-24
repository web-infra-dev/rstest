import { expect, it, rs } from '@rstest/core';
import * as barMod from '../src/bar.js';
import { sum } from '../src/sum.js';

rs.mock('../src/foo.js', async () => {
  return { foo: barMod.bar };
});

it('1', () => {
  expect(sum).toBe('bar1');
});
