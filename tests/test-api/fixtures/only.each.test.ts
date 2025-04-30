import { expect, it } from '@rstest/core';

it.only.each([
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
])('%i + %i should be %i', (a, b, expected) => {
  expect(a + b).toBe(expected);
});

it('will not be run', () => {
  expect(1 + 1).toBe(1);
});
