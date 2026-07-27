import { expect, it } from '@rstest/core';

it('sees the globalSetup env change inside the worker', () => {
  expect(process.env.RSTEST_API_GS_ENV).toBe('from-global-setup');
});
