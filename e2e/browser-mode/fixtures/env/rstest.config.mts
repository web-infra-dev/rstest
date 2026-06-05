import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.env,
  },
  include: ['tests/**/*.test.ts'],
  env: {
    RSTEST_E2E_ENV_FOO: 'bar',
    RSTEST_E2E_ENV_EMPTY: '',
    // In browser mode, env is injected into runtime env store.
    // Setting a key to undefined should remove it from the store.
    RSTEST_E2E_ENV_UNSET: undefined,
  },
});
