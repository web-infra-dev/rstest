import { expect, it } from '@rstest/core';

it('browser side alpha', () => {
  expect(typeof document).toBe('object');
});

it('browser side beta', () => {
  expect(document.nodeType).toBe(9);
});
