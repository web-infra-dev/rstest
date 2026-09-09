import { federation } from '@module-federation/rstest';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  federation: true,
  globalSetup: ['./scripts/rstestBrowserGlobalSetup.ts'],
  setupFiles: ['./scripts/rstestBrowser.setup.ts'],
  include: ['./test/*.browser.test.tsx'],
  testTimeout: 30_000,
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: Boolean(process.env.CI),
    port: 3002,
    providerOptions: process.env.CI
      ? {
          launch: {
            channel: 'chrome',
          },
        }
      : undefined,
  },
  plugins: [
    pluginReact(),
    federation({
      name: 'main_app_browser_test',
      remoteType: 'script',
      remotes: {
        'component-app': 'component_app@http://localhost:3001/remoteEntry.js',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.0' },
        'react-dom': {
          singleton: true,
          requiredVersion: '^19.2.0',
        },
      },
    }),
  ],
});
