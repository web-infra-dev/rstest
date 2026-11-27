import { expect, it } from '@rstest/core';

it('passes alpha', () => {
  expect(1 + 1).toBe(2);
});

it('passes beta', () => {
  expect(2 + 2).toBe(4);
});
