import path from 'node:path';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { federation } from '@module-federation/rstest-plugin';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  testEnvironment: 'node',
  plugins: [pluginReact(), federation()],
  testTimeout: 15000,
  federation: true,
  tools: {
    rspack: (config) => {
      config.plugins ??= [];
      config.plugins.push(
        new ModuleFederationPlugin({
          name: 'component_app_node_test',
          library: { type: 'commonjs-module', name: 'component_app_node_test' },
          remoteType: 'commonjs',
          remotes: {
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
              target: 'node', // Required for Node.js test environment
            },
          },
        }),
      );
      return config;
    },
  },
});
