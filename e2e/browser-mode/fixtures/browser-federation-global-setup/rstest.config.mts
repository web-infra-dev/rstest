import { federation } from '@module-federation/rstest';
import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig, type RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-federation-global-setup'],
  },
  globalSetup: ['./globalSetup.ts'],
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  plugins: [
    {
      name: 'federation-stage-mutation',
      setup(api) {
        const rstestApi = api.useExposed<RstestExposeAPI>('rstest')!;
        const target = rstestApi.getRstestConfig().browser?.enabled
          ? 'browser'
          : 'stage';
        rstestApi.modifyRstestConfig((config) => {
          const previous = config.env?.RSTEST_E2E_PLUGIN_TARGETS;
          // Appending (not replacing) is what detects a second application of this callback.
          config.env = {
            ...config.env,
            RSTEST_E2E_PLUGIN_TARGETS: previous
              ? `${previous},${target}`
              : target,
          };
        });
      },
    } satisfies RsbuildPlugin,
    federation({
      name: 'browser_federation_global_setup',
      remoteType: 'script',
      remotes: {
        'browser-setup-remote': `browser_setup_remote@http://127.0.0.1:${BROWSER_PORTS['browser-federation-global-setup-remote']}/remoteEntry.js`,
      },
    }),
  ],
});
