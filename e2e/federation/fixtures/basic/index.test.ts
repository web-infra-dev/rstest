import { expect, it } from '@rstest/core';

it('should expose the federation flag and dynamic import fallback', async () => {
  expect((globalThis as any).__rstest_federation__).toBe(true);

  const dynamicImport = (globalThis as any).__rstest_dynamic_import__;
  expect(typeof dynamicImport).toBe('function');

  // The fallback must load modules via native dynamic import, the way
  // vm-evaluated Module Federation runtime chunks rely on it.
  const pathModule = await dynamicImport('node:path');
  expect(typeof pathModule.join).toBe('function');
});

it('should set the federation flag during global setup', () => {
  expect(process.env.RSTEST_E2E_FEDERATION_IN_SETUP).toBe('true');
});
