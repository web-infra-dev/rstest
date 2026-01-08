import path from 'node:path';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  setupFiles: ['./scripts/rstest.setup.ts'],
  testTimeout: 30_000,
  testEnvironment: 'jsdom',
  plugins: [pluginReact()],
  federation: true,
  output: {
    module: false,
  },
  tools: {
    rspack: (config) => {
      // Build host for Node federation runtime (async-node) even though tests run
      // under JSDOM. This keeps remote resolution consistent with "node" tests.
      config.target = 'async-node';
      config.optimization ??= {};
      config.optimization.splitChunks = false;
      config.output = { ...(config.output ?? {}), publicPath: 'auto' };
      config.plugins ??= [];
      config.plugins.push(
        new ModuleFederationPlugin({
          name: 'main_app_web',
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
        }),
      );
      return config;
    },
  },
});
