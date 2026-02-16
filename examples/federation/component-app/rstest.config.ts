import path from 'node:path';
import { federation } from '@module-federation/rstest-plugin';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  testEnvironment: 'node',
  plugins: [
    pluginReact(),
    federation({
      name: 'component_app_node_test',
      remoteType: 'commonjs',
      remotes: {
        'node-local-remote': `commonjs ${path.resolve(
          __dirname,
          '../node-local-remote/dist-node/remoteEntry.js',
        )}`,
      },
      shared: {
        react: { singleton: true, eager: true, requiredVersion: '19.2.3' },
        'react-dom': {
          singleton: true,
          eager: true,
          requiredVersion: '19.2.3',
        },
      },
    }),
  ],
  testTimeout: 15000,
  federation: true,
});
