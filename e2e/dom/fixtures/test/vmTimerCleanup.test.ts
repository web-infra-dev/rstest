import { expect, registerFileCleanup, test } from '@rstest/core';

test('cancels pending VM immediate callbacks during DOM teardown', () => {
  expect(typeof window).toBe('object');

  registerFileCleanup(() => {
    setImmediate(() => {
      throw new Error(
        `Pending DOM immediate ran after file cleanup (window: ${typeof window})`,
      );
    });
  });
});
