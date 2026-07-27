import { expect, it } from '@rstest/core';

it('should not install federation shims by default', () => {
  expect((globalThis as any).__rstest_federation__).toBe(false);
  expect((globalThis as any).__rstest_dynamic_import__).toBeUndefined();
});
