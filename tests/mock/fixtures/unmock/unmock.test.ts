import crypto from 'node:crypto';
import { expect, it, rs } from '@rstest/core';

rs.unmock('node:crypto');

it('should run setup file correctly2', () => {
  expect(typeof crypto.randomFill === 'function').toBe(true);
});
