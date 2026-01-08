import { expect, test } from '@rstest/core';

test('node-local-remote federated import returns expected value', async () => {
  // IMPORTANT: Do not `require()` the remoteEntry directly.
  // Always go through Module Federation's runtime via a federated import.
  const mod = await import('node-local-remote/test');
  expect(mod?.default ?? mod).toBe('module from node-local-remote');
});
