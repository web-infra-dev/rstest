import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';
import baseConfig from './rstest.config.mts';

export default defineConfig({
  ...baseConfig,
  include: ['tests/testingLibraryDom.test.tsx'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: false,
    port: BROWSER_PORTS['watch-headed'],
    providerOptions: {
      launch: {
        args: [`--remote-debugging-port=${BROWSER_PORTS['watch-headed-cdp']}`],
      },
    },
  },
});
