import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// `includeSource` files are discovered and executed by the browser project,
// with `import.meta.rstest` exposing the runtime API.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-in-source'],
  },
  include: ['tests/**/*.test.ts'],
  includeSource: ['src/**/*.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
