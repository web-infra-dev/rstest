import { describe, expect, it } from '@rstest/core';

describe('browser env injection', () => {
  it('should expose process.env in browser and apply env changes', () => {
    // Browser client ensures global alias exists for libraries expecting Node globals.
    expect((globalThis as any).global).toBe(globalThis);

    expect(typeof (globalThis as any).process).toBe('object');
    expect(process.env.RSTEST_E2E_ENV_FOO).toBe('bar');
    expect(process.env.RSTEST_E2E_ENV_EMPTY).toBe('');
    expect(process.env.RSTEST_E2E_ENV_UNSET).toBeUndefined();
    expect(Object.hasOwn(process.env, 'RSTEST_E2E_ENV_UNSET')).toBe(false);
  });
});
