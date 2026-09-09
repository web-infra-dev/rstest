import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  projects: [
    {
      name: 'browser-silent',
      include: ['tests/projects.test.ts'],
      silent: 'passed-only',
      env: {
        RSTEST_E2E_SILENT_PROJECT: 'browser-silent',
      },
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS.silent,
      },
      testTimeout: BROWSER_TEST_TIMEOUT,
    },
    {
      name: 'browser-loud',
      include: ['tests/projects.test.ts'],
      silent: false,
      env: {
        RSTEST_E2E_SILENT_PROJECT: 'browser-loud',
      },
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS.silent,
      },
      testTimeout: BROWSER_TEST_TIMEOUT,
    },
  ],
});
