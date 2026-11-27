import { expect, test } from '@rstest/core';
import { registerFileCleanup } from '@rstest/core/internal/node-runtime';

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
