import { withRspackConfig } from '@rstest/adapter-rspack';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: withRspackConfig(),
  // Real Chrome (channel=chrome) cold-launch on CI runners (esp. Windows) can
  // exceed the default 5s test timeout, so relax it under CI.
  testTimeout: process.env.CI ? 15_000 : 5_000,
  browser: {
    enabled: true,
    provider: 'playwright',
    providerOptions: process.env.CI
      ? {
          launch: {
            channel: 'chrome',
          },
        }
      : undefined,
  },
  include: ['tests/**/*.test.tsx'],
});
