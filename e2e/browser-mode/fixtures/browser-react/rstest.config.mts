import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  plugins: [pluginReact()],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-react'],
  },
  include: ['tests/**/*.test.tsx'],
  setupFiles: ['./tests/rstest.setup.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
