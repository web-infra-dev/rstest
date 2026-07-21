import { expect, test } from '@rstest/core';

test('plain browser test without config hooks', () => {
  expect(1 + 1).toBe(2);
});
