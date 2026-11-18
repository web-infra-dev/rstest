import { defineConfig } from '@rstest/core';
import base from './rstest.config.mts';

export default defineConfig({
  ...base,
  browser: {
    ...base.browser,
    provider: 'playwright',
    providerOptions: { context: { isMobile: true, deviceScaleFactor: 2 } },
  },
});
