import { expect, test } from '@rstest/core';

test('runs in the non-empty browser project', () => {
  expect(typeof window).toBe('object');
  expect(1 + 1).toBe(2);
});
