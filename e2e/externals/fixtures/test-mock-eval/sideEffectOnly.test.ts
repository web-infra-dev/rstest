import { expect, it, rs } from '@rstest/core';
import * as actual from 'cjs-shaped' with { rstest: 'importActual' };
import 'sfx-mod';

// A side-effect-only import never reads an export, so nothing materializes
// the lazy mock on access; the worker's post-evaluation flush must run the
// factory instead.
rs.mock('sfx-mod', () => {
  (globalThis as any).__MOCK_FACTORY_RAN = true;
  return { flag: 'MOCKED' };
});

void actual;

it('should run the factory of a side-effect-only imported mock', () => {
  expect((globalThis as any).__MOCK_FACTORY_RAN).toBe(true);
  expect((globalThis as any).__RSTEST_SFX_REAL_RAN).toBeUndefined();
});
