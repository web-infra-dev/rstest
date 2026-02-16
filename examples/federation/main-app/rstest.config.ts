import path from 'node:path';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { federation } from '@module-federation/rstest-plugin';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  setupFiles: ['./scripts/rstest.setup.ts'],
  testTimeout: 30_000,
  testEnvironment: 'jsdom',
  plugins: [pluginReact(), federation()],
  federation: true,
  // `federation()` already enforces CommonJS output (`output.module: false`).
  tools: {
    rspack: (config) => {
      config.plugins ??= [];
      config.plugins.push(
        new ModuleFederationPlugin({
          name: 'main_app_web',
          library: { type: 'commonjs-module', name: 'main_app_web' },
          // IMPORTANT: Keep these federation settings stable.
          //
          // - `remoteType: 'script'` is required so the Module Federation Node runtime plugin
          //   can load `remoteEntry.js` over HTTP in a Node (async-node) execution context,
          //   even though tests run in JSDOM.
          //
          // - `component-app` must stay as an HTTP remote:
          //   `component_app@http://localhost:3001/remoteEntry.js`
          //
          // - `node-local-remote` must stay as a filesystem (abs-path) CommonJS remoteEntry:
          //   `commonjs <abs-path-to-remoteEntry.js>`
          remoteType: 'script',
          remotes: {
            'component-app':
              'component_app@http://localhost:3001/remoteEntry.js',
            'node-local-remote': `commonjs ${path.resolve(
              __dirname,
              '../node-local-remote/dist-node/remoteEntry.js',
            )}`,
          },
          runtimePlugins: ['@module-federation/node/runtimePlugin'],
          shared: {
            react: { singleton: true, eager: true, requiredVersion: '19.2.3' },
            'react-dom': {
              singleton: true,
              eager: true,
              requiredVersion: '19.2.3',
            },
          },
          experiments: {
            optimization: {
              target: 'node', // Required for JSDOM test environments
            },
          },
        }),
      );
      return config;
    },
  },
});
