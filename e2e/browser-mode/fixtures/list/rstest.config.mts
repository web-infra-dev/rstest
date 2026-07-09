import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import type { RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

const modifyBrowserListConfigPlugin = (): RsbuildPlugin => ({
  name: 'modify-browser-list-config',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    const rstestApi = api.useExposed<RstestExposeAPI>('rstest');
    rstestApi?.modifyRstestConfig((config) => {
      config.include = ['tests/**/*.test.ts', 'modified/**/*.test.ts'];
    });
  },
});

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.list,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  plugins: [modifyBrowserListConfigPlugin()],
});
