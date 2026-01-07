import path from 'node:path';
import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
export default defineConfig({
  testEnvironment: 'node',
  plugins: [pluginReact()],
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  federation: true,
  // Module Federation's Node runtime may load chunks via `fs` when running in Node.
  // Ensure the test build output is written to disk so those chunks exist.
  dev: {
    writeToDisk: true,
  },
  output: {
    // Module Federation's Node runtime works best with CJS output in our test runner.
    // This also ensures `__rstest_dynamic_import__` is injected as a function argument
    // rather than relying on ESM `import.meta` shims.
    module: false,
  },
  tools: {
    // Enable Rspack-level customization so federated imports like `component-app/Button`
    // can be handled by the Module Federation runtime.
    rspack: (config) => {
      config.output = {
        ...(config.output ?? {}),
        // Avoid hard-coding dev-server URLs for test builds.
        publicPath: 'auto',
      };
      (config as any).builtins ??= {} as any;
      (config as any).builtins.define = {
        ...(((config as any).builtins.define as any) ?? {}),
        __NODE_LOCAL_REMOTE__: 'true',
      } as any;

      config.plugins ??= [];
      const nodeLocalEntry = path.resolve(
        __dirname,
        '../../node-local-remote/dist-node/remoteEntry.js',
      );

      config.plugins.push(
        new ModuleFederationPlugin({
          name: 'main_app',
          library: { type: 'commonjs-module', name: 'main_app' },
          remoteType: 'script',
          remotes: {
            'component-app':
              'component_app@http://localhost:3003/remoteEntry.js',
            'node-local-remote': `commonjs ${nodeLocalEntry}`,
          },
          runtimePlugins: ['@module-federation/node/runtimePlugin'],
          shared: {
            react: { singleton: true, requiredVersion: '19.2.3' },
            'react-dom': { singleton: true, requiredVersion: '19.2.3' },
          },
        }),
      );

      return config;
    },
  },
});
