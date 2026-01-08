import type { RsbuildPlugin } from '@rsbuild/core';
import type { RstestContext } from '../../types';

export const shouldKeepBundledForFederation = (request: string): boolean => {
  // Module Federation runtimes can generate "loader-style" requests that embed
  // inline JS via a `data:` URL (e.g. `something!=!data:text/javascript,...`).
  // Externalizing those breaks because Node can't resolve them via require/import.
  if (request.includes('!=!data:') && request.includes('javascript')) {
    return true;
  }

  // Keep MF runtime packages bundled when federation is enabled. They participate
  // in runtime bootstrapping and may be referenced through loader-style specifiers.
  if (request.startsWith('@module-federation/')) {
    return true;
  }

  return false;
};

export const pluginFederationCompat: (context: RstestContext) => RsbuildPlugin =
  (context) => ({
    name: 'rstest:federation-compat',
    setup: (api) => {
      api.modifyRspackConfig(async (config, { environment }) => {
        const project = context.projects.find(
          (p) => p.environmentName === environment.name,
        );
        if (!project?.normalizedConfig.federation) return;

        // Rstest executes tests in a Node worker process even for DOM-like test
        // environments (jsdom/happy-dom). When federation is enabled, always build
        // with Rspack's `async-node` target so Module Federation's Node runtime can
        // load remote chunks over the network.
        config.target = 'async-node';

        // Keep federation builds in a single chunk to avoid MF generating async
        // fallback chunks for `loadShareSync` initial consumes.
        config.optimization ??= {};
        config.optimization.splitChunks = false;

        // Do not patch Module Federation plugin options. Users should configure
        // shared/consumes behavior explicitly in their project configs.
      });
    },
  });
