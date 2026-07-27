import { expect, it } from '@rstest/core';

it('should reinstall the federation dynamic import fallback for reused workers', async () => {
  expect((globalThis as any).__rstest_federation__).toBe(true);

  const dynamicImport = (globalThis as any).__rstest_dynamic_import__;
  expect(typeof dynamicImport).toBe('function');

  const mod = await dynamicImport('./reuse-target.mjs');
  expect(mod.marker).toBe('federation-reuse');
});
