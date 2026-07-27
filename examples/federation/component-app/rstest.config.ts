import path from 'node:path';
import { federation } from '@module-federation/rstest';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig, defineInlineProject } from '@rstest/core';

const shared = {
  react: { singleton: true, requiredVersion: '^19.2.0' },
  'react-dom': {
    singleton: true,
    requiredVersion: '^19.2.0',
  },
};

export default defineConfig({
  projects: [
    defineInlineProject({
      name: 'component-node',
      include: [
        './test/*.ssr.test.ts',
        './test/NodeLocalRemote.container.test.ts',
      ],
      setupFiles: ['./scripts/rstest.setup.ts'],
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
          shared,
        }),
      ],
      testTimeout: 15000,
    }),
    defineInlineProject({
      name: 'component-csr',
      include: ['./test/*.csr.test.tsx'],
      testEnvironment: 'jsdom',
      plugins: [
        pluginReact(),
        federation({
          name: 'component_app_csr_test',
          remoteType: 'commonjs',
          remotes: {
            'component-app': `commonjs ${path.resolve(
              __dirname,
              './dist-node/remoteEntry.cjs',
            )}`,
          },
          shared,
        }),
      ],
    }),
  ],
});
