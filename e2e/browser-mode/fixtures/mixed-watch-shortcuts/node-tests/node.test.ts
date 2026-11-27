import { expect, it } from '@rstest/core';

it('node side alpha', () => {
  expect('node').toBe('node');
});

it('node side beta', () => {
  expect('node-beta').toBe('node-beta');
});
