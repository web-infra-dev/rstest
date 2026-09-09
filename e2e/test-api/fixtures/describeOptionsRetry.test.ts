import { describe, expect, it } from '@rstest/core';

// A `retry` set on `describe` propagates to inner tests as a default; a
// per-test `retry` still overrides it.
describe('suite retry propagates', { retry: 2 }, () => {
  let inherited = 0;
  it('inner test inherits the suite retry budget', () => {
    inherited++;
    // Pass on the third attempt (initial + 2 inherited retries).
    expect(inherited).toBe(3);
  });

  let overridden = 0;
  it('per-test retry overrides the suite retry', { retry: 0 }, () => {
    overridden++;
    // retry: 0 disables retries even though the suite set retry: 2.
    expect(overridden).toBe(1);
  });
});
