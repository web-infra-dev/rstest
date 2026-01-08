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
      api.modifyEnvironmentConfig(
        async (config, { mergeEnvironmentConfig, name }) => {
          const project = context.projects.find(
            (p) => p.environmentName === name,
          );
          if (!project?.normalizedConfig.federation) return config;

          // Ensure CommonJS output at the Rstest environment config level.
          // This propagates to normalized config so other plugins (e.g. externals)
          // can respect `outputModule` consistently.
          const merged = await mergeEnvironmentConfig(config, {
            output: {
              module: false,
            },
            tools: {
              rspack: (rspackConfig) => {
                // Tests run in Node workers even for DOM-like environments.
                // Use async-node target and avoid splitChunks for federation.
                rspackConfig.target = 'async-node';
                rspackConfig.optimization ??= {};
                rspackConfig.optimization.splitChunks = false;

                // Configure ModuleFederationPlugin instances to target node environment
                // This sets ENV_TARGET='node' in the federation runtime
                if (rspackConfig.plugins) {
                  rspackConfig.plugins = rspackConfig.plugins.map(
                    (plugin: any) => {
                      // Check if this is a ModuleFederationPlugin by checking for
                      // known properties/methods
                      if (
                        plugin &&
                        plugin._options &&
                        (plugin._options.name ||
                          plugin._options.remotes ||
                          plugin._options.exposes)
                      ) {
                        // Ensure experiments.optimization.target is set to 'node'
                        plugin._options.experiments =
                          plugin._options.experiments || {};
                        plugin._options.experiments.optimization =
                          plugin._options.experiments.optimization || {};
                        plugin._options.experiments.optimization.target =
                          'node';
                      }
                      return plugin;
                    },
                  );
                }
              },
            },
          });

          return merged;
        },
      );
    },
  });
