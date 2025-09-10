import { expect, test } from '@rstest/core';

test('expect.soft test', () => {
  expect.soft(1 + 1).toBe(3); // should mark the test as fail and continue
  expect.soft(1 + 2).toBe(4); // should mark the test as fail and continue
  expect.soft(1 + 3).toBe(4);
});
