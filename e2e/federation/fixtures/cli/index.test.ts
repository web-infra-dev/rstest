import { expect, it } from '@rstest/core';

it('should enable federation mode from the CLI flag', () => {
  expect((globalThis as any).__rstest_federation__).toBe(true);
  expect(typeof (globalThis as any).__rstest_dynamic_import__).toBe('function');
});
