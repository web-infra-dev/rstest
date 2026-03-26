import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['no-tests'],
  },
  // Intentionally points to a non-existing directory to cover the
  // "No test files found" branch in browser mode.
  include: ['tests/**/*.test.ts'],
});
