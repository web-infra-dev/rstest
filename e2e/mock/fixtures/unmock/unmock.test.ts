import crypto from 'node:crypto';
import { expect, it, rs } from '@rstest/core';
import { a } from './a';

rs.unmock('node:crypto');
rs.unmock('./a');

it('should run setup file correctly2', () => {
  expect(a).toBe(1);
  expect(typeof crypto.randomFill === 'function').toBe(true);
});
