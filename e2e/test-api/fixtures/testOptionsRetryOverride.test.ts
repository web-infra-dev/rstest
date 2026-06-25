import { expect, it } from '@rstest/core';

// Two cases share one file so a single `--retry=5` config exposes both
// directions of override.

let extendingAttempts = 0;
it('options.retry can extend config.retry', { retry: 9 }, () => {
  extendingAttempts++;
  // Pass on attempt 8, which exceeds config.retry=5 but fits options.retry=9.
  expect(extendingAttempts).toBe(8);
});

let disablingAttempts = 0;
it('options.retry: 0 disables config.retry', { retry: 0 }, () => {
  disablingAttempts++;
  // Force a failure; options.retry=0 should stop retries immediately even
  // though config.retry=5 is set.
  throw new Error(`attempt ${disablingAttempts}`);
});
