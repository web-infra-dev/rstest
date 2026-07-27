import { expect, test } from '@rstest/core';

// Top-level delay before any test is declared: browser collect must wait for
// module evaluation (within the shared collect `timeoutMs`, default 30s) before
// the test below becomes discoverable. If collect cut off early, `rstest list`
// would miss this test.
await new Promise((resolve) => setTimeout(resolve, 500));

test('collected after a slow module load', () => {
  expect(true).toBe(true);
});
