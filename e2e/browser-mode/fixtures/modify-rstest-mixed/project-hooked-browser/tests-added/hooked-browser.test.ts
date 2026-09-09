import { expect, test } from '@rstest/core';

test('browser test added by modifyRstestConfig in mixed mode', () => {
  expect(globalThis.document).toBeDefined();
  expect(
    (
      globalThis as typeof globalThis & {
        __hookedBrowserSetupCount?: number;
      }
    ).__hookedBrowserSetupCount,
  ).toBe(1);
});
