import { expect, it } from '@rstest/core';

let attempts = 0;

it('passes after retry', () => {
  attempts += 1;
  expect(attempts).toBe(2);
});
