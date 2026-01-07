import type { RsbuildPlugin } from '@rsbuild/core';
import type { RstestContext } from '../../types';

export const pluginFederationCompat: (context: RstestContext) => RsbuildPlugin =
  (context) => ({
    name: 'rstest:federation-compat',
    setup: (api) => {
      api.modifyRspackConfig(async (config, { environment }) => {
        const project = context.projects.find(
          (p) => p.environmentName === environment.name,
        );
        if (!project?.normalizedConfig.federation) return;
        if (project.normalizedConfig.testEnvironment.name !== 'node') return;

        // Rsbuild doesn't model `async-node`, but Rspack does. MF's Node runtime
        // relies on it to load remote chunks over the network.
        config.target = 'async-node';

        // Keep node builds in a single chunk to avoid MF generating async
        // fallback chunks for `loadShareSync` initial consumes.
        config.optimization ??= {};
        config.optimization.splitChunks = false;

        // Do not patch Module Federation plugin options. Users should configure
        // shared/consumes behavior explicitly in their project configs.
      });
    },
  });
