import { expect, it, rs } from '@rstest/core';
import { bar } from '../src/bar.js';
import { sum } from '../src/sum.js';

rs.mock('./foo.js', async () => {
  return { foo: bar };
});

it('1', () => {
  expect(sum).toBe('bar1');
});
