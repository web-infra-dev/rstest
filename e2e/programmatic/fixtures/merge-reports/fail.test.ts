import { expect, it } from '@rstest/core';

it('fails on purpose', () => {
  expect(1 + 1).toBe(3);
});
