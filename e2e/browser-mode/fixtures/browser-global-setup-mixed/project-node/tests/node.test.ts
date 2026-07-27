import { expect, it } from '@rstest/core';

it('reads the node project globalSetup env change', () => {
  expect(process.env.RSTEST_E2E_GS_NODE).toBe('from-node-setup');
});
