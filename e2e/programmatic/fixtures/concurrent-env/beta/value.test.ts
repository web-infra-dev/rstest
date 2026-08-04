import { expect, it } from '@rstest/core';

it("reads its own run's globalSetup value, not the other run's", () => {
  expect(process.env.RSTEST_API_CONCURRENT_ENV).toBe('beta');
});
