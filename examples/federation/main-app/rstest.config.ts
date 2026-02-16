import path from 'node:path';
import { federation } from '@module-federation/rstest-plugin';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  setupFiles: ['./scripts/rstest.setup.ts'],
  testTimeout: 30_000,
  testEnvironment: 'jsdom',
  plugins: [
    pluginReact(),
    federation({
      name: 'main_app_web',
      remotes: {
        'component-app': 'component_app@http://localhost:3001/remoteEntry.js',
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
  federation: true,
});
