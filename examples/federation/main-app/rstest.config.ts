import path from 'node:path';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
export default defineConfig({
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  testTimeout: 15000,
  projects: [
    {
      name: 'main-app-node',
      testEnvironment: 'node',
      plugins: [pluginReact()],
      federation: true,
      exclude: ['test/**/*.rtl.*'],
      dev: { writeToDisk: true },
      output: { module: false },
      tools: {
        rspack: (config) => {
          config.output = { ...(config.output ?? {}), publicPath: 'auto' };
          (config as any).builtins ??= {} as any;
          (config as any).builtins.define = {
            ...(((config as any).builtins.define as any) ?? {}),
            __NODE_LOCAL_REMOTE__: 'true',
          } as any;
          config.plugins ??= [];
          const nodeLocalEntryAbs = path.resolve(
            __dirname,
            '../node-local-remote/dist-node/remoteEntry.js',
          );
          config.plugins.push(
            new ModuleFederationPlugin({
              name: 'main_app_node',
              library: { type: 'commonjs-module', name: 'main_app_node' },
              remoteType: 'script',
              remotes: {
                'component-app':
                  'component_app@http://localhost:3003/remoteEntry.js',
                'node-local-remote': `commonjs ${nodeLocalEntryAbs}`,
              },
              runtimePlugins: ['@module-federation/node/runtimePlugin'],
              shared: {
                react: {
                  singleton: true,
                  eager: true,
                  requiredVersion: '19.2.3',
                },
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
    },
    {
      name: 'main-app-jsdom',
      testEnvironment: 'jsdom',
      plugins: [pluginReact()],
      federation: true,
      tools: {
        rspack: (config) => {
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
              shared: {
                react: {
                  singleton: true,
                  eager: true,
                  requiredVersion: '19.2.3',
                },
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
      include: ['test/**/*.rtl.*'],
    },
  ],
});
