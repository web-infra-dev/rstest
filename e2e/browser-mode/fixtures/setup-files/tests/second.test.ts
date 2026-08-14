import { expect, it } from '@rstest/core';

it('runs setup hooks in a later file', () => {
  const globals = globalThis as Record<string, unknown>;
  expect(globals.__SETUP_EXECUTED__).toBe(true);
  expect(globals.__SETUP_BEFORE_EACH_COUNT__).toBe(1);
});
