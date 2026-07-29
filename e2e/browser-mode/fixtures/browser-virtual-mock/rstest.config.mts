import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  resolve: {
    alias: {
      'virtual-browser-module': false,
    },
  },
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-virtual-mock'],
  },
  testTimeout: BROWSER_TEST_TIMEOUT,
});
