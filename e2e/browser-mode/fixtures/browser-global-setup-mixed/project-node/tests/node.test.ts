import { describe, expect, it } from '@rstest/core';

describe(`node collection sees browser setup (${process.env.RSTEST_E2E_GS_BROWSER})`, () => {
  it('reads the node project globalSetup env change', () => {
    expect(process.env.RSTEST_E2E_GS_NODE).toBe('from-node-setup');
  });
});
