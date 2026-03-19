import path from 'node:path';
import { federation } from '@module-federation/rstest';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  setupFiles: ['./scripts/rstest.setup.ts'],
  testEnvironment: 'node',
  plugins: [
    pluginReact(),
    federation({
      name: 'component_app_node_test',
      experiments: {
        asyncStartup: true,
      },
      remoteType: 'commonjs',
      remotes: {
        'node-local-remote': `commonjs ${path.resolve(
          __dirname,
          '../node-local-remote/dist-node/remoteEntry.js',
        )}`,
      },
      shared: {
        react: { singleton: true, requiredVersion: '19.2.4' },
        'react-dom': {
          singleton: true,
          requiredVersion: '19.2.4',
        },
      },
    }),
  ],
  testTimeout: 15000,
  federation: true,
});
