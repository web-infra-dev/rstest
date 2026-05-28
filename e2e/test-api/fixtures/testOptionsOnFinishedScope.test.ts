import { expect, it } from '@rstest/core';

// Regression: handlers registered via context.onTestFinished /
// context.onTestFailed inside the test body must be scoped to a single
// attempt — they should not stack across retries or repeats.
let runs = 0;
let cleanupCalls = 0;

it(
  'onTestFinished does not leak across repeats',
  ({ onTestFinished }) => {
    runs++;
    onTestFinished(() => {
      cleanupCalls++;
    });
  },
  { repeats: 2 },
);

let retryAttempts = 0;
let retryCleanupCalls = 0;
it(
  'onTestFinished does not leak across retries',
  ({ onTestFinished }) => {
    retryAttempts++;
    onTestFinished(() => {
      retryCleanupCalls++;
    });
    // Force a retry by failing the first attempt.
    expect(retryAttempts).toBe(2);
  },
  { retry: 1 },
);

it('cleanup count matches the number of attempts', () => {
  expect(runs).toBe(3);
  expect(cleanupCalls).toBe(3);
  expect(retryAttempts).toBe(2);
  expect(retryCleanupCalls).toBe(2);
});
