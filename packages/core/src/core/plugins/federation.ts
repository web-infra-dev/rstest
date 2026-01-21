import type { RsbuildPlugin } from '@rsbuild/core';
import { logger } from '../../utils';

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

/**
 * Enable Rstest's Module Federation compatibility mode for the current Rsbuild
 * environment.
 *
 * Add this to your `rstest.config.*`:
 *
 * ```ts
 * import { defineConfig, federation } from '@rstest/core';
 * export default defineConfig({
 *   federation: true,
 *   plugins: [federation()],
 * });
 * ```
 */
export const federation = (): RsbuildPlugin => ({
  name: 'rstest:federation',
  setup: (api) => {
    api.modifyEnvironmentConfig(async (config, { mergeEnvironmentConfig }) => {
      // Ensure CommonJS output at the Rsbuild environment config level.
      // This propagates to normalized config so other plugins can respect
      // `outputModule` consistently.
      const merged = mergeEnvironmentConfig(config, {
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

            // Validate that ModuleFederationPlugin instances have the correct config.
            if (rspackConfig.plugins) {
              for (const plugin of rspackConfig.plugins) {
                if (
                  plugin &&
                  typeof plugin === 'object' &&
                  plugin.constructor?.name === 'ModuleFederationPlugin'
                ) {
                  const options = (plugin as any)._options;
                  if (options && typeof options === 'object') {
                    if (options.experiments?.optimization?.target !== 'node') {
                      logger.warn(
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
    });
  },
});
