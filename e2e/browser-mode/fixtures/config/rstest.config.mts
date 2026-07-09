import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import type { RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

const modifyBrowserRstestConfigPlugin = (): RsbuildPlugin => ({
  name: 'modify-browser-rstest-config',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    const rstestApi = api.useExposed<RstestExposeAPI>('rstest');
    rstestApi?.modifyRstestConfig((config) => {
      if (process.env.RSTEST_E2E_MUTATE_BROWSER_HEADLESS) {
        config.browser ??= { provider: 'playwright' };
        config.browser.headless = false;
      }
      if (process.env.RSTEST_E2E_MUTATE_BUNDLE_DEPENDENCIES) {
        config.output ??= {};
        config.output.bundleDependencies = false;
      }
      config.include = [
        './*.test.ts',
        './git/*.test.ts',
        './modified/*.test.ts',
        './empty-before-hook/*.test.ts',
      ];
      config.source ??= {};
      config.source.define = {
        ...config.source.define,
        __MODIFY_RSTEST_CONFIG_DEFINE__: JSON.stringify('modified-value'),
      };
    });
  },
});

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.config,
  },
  include: ['./*.test.ts', './git/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  globals: true,
  plugins: [modifyBrowserRstestConfigPlugin()],
  source: {
    define: {
      __TEST_DEFINE__: JSON.stringify('define-value'),
    },
  },
  resolve: {
    alias: {
      '@test-alias': './aliasedModule.ts',
    },
  },
});
