import { expect, it } from '@rstest/core';

it('reads the browser project globalSetup env change', () => {
  expect(import.meta.env.RSTEST_E2E_GS_BROWSER).toBe('from-browser-setup');
  expect(process.env.RSTEST_E2E_GS_BROWSER).toBe('from-browser-setup');
});
