import type { RsbuildPlugin } from '@rsbuild/core';
import type { RstestContext } from '../../types';

// Note: ModuleFederationPlugin configuration should include
// experiments.optimization.target: 'node' when used with Rstest
// to ensure proper Node.js loading in JSDOM environments

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

                // Validate that ModuleFederationPlugin instances have the correct config
                if (rspackConfig.plugins) {
                  for (const plugin of rspackConfig.plugins) {
                    // Check if this looks like a ModuleFederationPlugin
                    if (
                      plugin &&
                      typeof plugin === 'object' &&
                      plugin.constructor?.name === 'ModuleFederationPlugin'
                    ) {
                      const options = (plugin as any)._options;
                      if (options && typeof options === 'object') {
                        // Validate experiments.optimization.target is set to 'node'
                        if (
                          options.experiments?.optimization?.target !== 'node'
                        ) {
                          console.warn(
                            `[Rstest Federation] ModuleFederationPlugin "${options.name || 'unnamed'}" should have experiments.optimization.target set to 'node' for JSDOM test environments.`,
                          );
                        }
                      }
                    }
                  }
                }
              },
            },
          });

          return merged;
        },
      );
    },
  });
