import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
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
