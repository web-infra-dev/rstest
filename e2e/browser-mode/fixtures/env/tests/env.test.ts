import { describe, expect, it, rstest } from '@rstest/core';

describe('browser env injection', () => {
  it('should apply env changes without injecting global process', () => {
    // Browser client ensures global alias exists for libraries expecting Node globals.
    expect((globalThis as any).global).toBe(globalThis);

    expect((globalThis as any).process).toBeUndefined();
    expect((globalThis as any).__RSTEST_ENV__).toBeUndefined();
    expect(Object.hasOwn(globalThis, '__RSTEST_ENV__')).toBe(false);

    expect(process.env.RSTEST_E2E_ENV_FOO).toBe('bar');
    expect(process.env.RSTEST_E2E_ENV_EMPTY).toBe('');
    expect(process.env.RSTEST_E2E_ENV_UNSET).toBeUndefined();
    expect(Object.hasOwn(process.env, 'RSTEST_E2E_ENV_UNSET')).toBe(false);

    const originalFoo = process.env.RSTEST_E2E_ENV_FOO;

    rstest.stubEnv('RSTEST_E2E_ENV_FOO', 'changed');
    rstest.stubEnv('RSTEST_E2E_ENV_DYNAMIC', 'dynamic');

    expect(process.env.RSTEST_E2E_ENV_FOO).toBe('changed');
    expect(process.env.RSTEST_E2E_ENV_DYNAMIC).toBe('dynamic');

    rstest.stubEnv('RSTEST_E2E_ENV_DYNAMIC', undefined);

    expect(process.env.RSTEST_E2E_ENV_DYNAMIC).toBeUndefined();

    rstest.unstubAllEnvs();

    expect(process.env.RSTEST_E2E_ENV_FOO).toBe(originalFoo);
    expect(process.env.RSTEST_E2E_ENV_DYNAMIC).toBeUndefined();
  });
});
