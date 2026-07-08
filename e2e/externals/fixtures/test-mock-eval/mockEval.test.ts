import { expect, it, rs } from '@rstest/core';
import boom from 'boom-on-eval';
import { real } from 'boom-esm';
import { flag } from 'sfx-mod';

rs.mock('boom-on-eval', () => ({ default: { mocked: true } }));
rs.mock('boom-esm', () => ({ real: 'MOCKED' }));
rs.mock('sfx-mod', () => ({ flag: 'MOCKED' }));

it('should not evaluate a mocked externalized CJS module that throws at import time', () => {
  expect(boom.mocked).toBe(true);
});

it('should not evaluate a mocked externalized ESM module that throws at import time', () => {
  expect(real).toBe('MOCKED');
});

it('should never run the real externalized module import-time side effects', () => {
  expect(flag).toBe('MOCKED');
  expect((globalThis as any).__RSTEST_SFX_REAL_RAN).toBeUndefined();
});
