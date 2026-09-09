import { expect, test } from '@rstest/core';

test('b: sees the real Date, not the pin leaked from a.test', () => {
  // Would be 2000 if a.test's date-only pin leaked into this reused worker.
  expect(new Date().getUTCFullYear()).toBeGreaterThan(2000);
});
