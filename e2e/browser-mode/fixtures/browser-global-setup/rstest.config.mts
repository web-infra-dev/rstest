import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig, type RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// The watch regression test drives stdin through a pipe.
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;

// A browser-only run propagates the isolated `globalSetup` worker's env changes
// into the browser runtime store, with explicit `test.env` config still taking
// precedence.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-global-setup'],
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  globalSetup: ['./globalSetup.ts'],
  plugins: [
    {
      name: 'test-global-teardown-order',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest');
        if (!rstestApi) {
          throw new Error('Rstest API is unavailable during plugin setup');
        }
        const rstestConfig = rstestApi.getRstestConfig();
        rstestApi.modifyRstestConfig((config) => {
          config.env = {
            ...config.env,
            RSTEST_E2E_PLUGIN_BROWSER_ENABLED: String(
              rstestConfig.browser?.enabled,
            ),
          };
        });
        api.onCloseDevServer(() => {
          console.log('[browser-dev-server] closed');
        });
      },
    } satisfies RsbuildPlugin,
  ],
  env: {
    RSTEST_E2E_GS_OVERRIDE: 'from-config',
  },
});
