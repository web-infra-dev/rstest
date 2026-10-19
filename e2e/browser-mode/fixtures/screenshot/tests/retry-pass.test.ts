import { expect, it } from '@rstest/core';

let attempts = 0;

it('passes after a failed retry', () => {
  attempts++;
  expect(attempts).toBeGreaterThan(1);
});
