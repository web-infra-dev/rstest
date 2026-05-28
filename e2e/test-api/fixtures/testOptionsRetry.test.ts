import { beforeEach, expect, it } from '@rstest/core';

// `it` per-test retry should override config.retry (run without --retry).
let attempts = 0;
let beforeEachCalls = 0;

beforeEach(() => {
  beforeEachCalls++;
});

it(
  'per-test retry overrides config retry',
  () => {
    attempts++;
    // Pass on the third attempt (initial + 2 retries).
    expect(attempts).toBe(3);
    // beforeEach should have run for every attempt, including the passing one.
    expect(beforeEachCalls).toBe(attempts);
  },
  { retry: 2 },
);
