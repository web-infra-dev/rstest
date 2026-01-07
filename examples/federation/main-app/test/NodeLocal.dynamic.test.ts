import { expect, test } from '@rstest/core';

test('node-local remote dynamic import returns expected value', async () => {
  const mod = await import('node-local-remote/test');
  expect(mod.default).toBe('module from node-local-remote');
});
