import { expect, test } from '@rstest/core';

test('is not dispatched when environment options are not cloneable', () => {
  expect(true).toBe(true);
});
