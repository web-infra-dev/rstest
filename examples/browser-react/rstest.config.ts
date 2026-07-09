import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  // Real Chrome (channel=chrome) cold-launch on CI runners (esp. Windows) can
  // exceed the default 5s test timeout, so relax it under CI.
  testTimeout: process.env.CI ? 30_000 : 5_000,
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
  plugins: [pluginReact()],
});
