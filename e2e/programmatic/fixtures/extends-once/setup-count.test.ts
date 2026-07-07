import { expect, it } from '@rstest/core';

it('runs the extends-contributed setup file exactly once', () => {
  const g = globalThis as { __SETUP_COUNT__?: number };
  expect(g.__SETUP_COUNT__).toBe(1);
});
