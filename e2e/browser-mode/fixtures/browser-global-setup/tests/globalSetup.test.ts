import { describe, expect, it } from '@rstest/core';

describe('browser globalSetup env propagation', () => {
  it('reads env changes made by globalSetup on the host', () => {
    console.log('[browser-global-setup-test] running');

    expect(import.meta.env.RSTEST_E2E_GS).toBe('from-global-setup');
    expect(process.env.RSTEST_E2E_GS).toBe('from-global-setup');
  });

  it('keeps explicit test.env config precedence over globalSetup changes', () => {
    expect(import.meta.env.RSTEST_E2E_GS_OVERRIDE).toBe('from-config');
    expect(process.env.RSTEST_E2E_GS_OVERRIDE).toBe('from-config');
  });

  it('keeps the built-in static env values', () => {
    expect(import.meta.env.NODE_ENV).toBe('test');
    expect(process.env.RSTEST).toBe('true');
  });
});
