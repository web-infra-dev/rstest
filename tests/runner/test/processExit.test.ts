import { expect, it } from '@rstest/core';

it('Calling process.exit will turn to throw an error', () => {
  let err: Error | null = null;
  try {
    process.exit(42);
  } catch (error) {
    err = error as Error;
  }

  expect(err?.message).toBe('process.exit unexpectedly called with "42"');
});
