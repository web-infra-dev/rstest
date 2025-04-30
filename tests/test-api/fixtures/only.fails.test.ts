import { expect, it } from '@rstest/core';

it.only.fails('will pass when failed', () => {
  expect(1 + 1).toBe(1);
});

it('will not run', () => {
  expect(1 + 1).toBe(1);
});
