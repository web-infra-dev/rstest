import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import { castArray, logger } from '../../utils';

// Note: ModuleFederationPlugin configuration should include
// experiments.optimization.target: 'node' when used with Rstest
// to ensure proper Node.js loading in JSDOM environments

const addRemoteNames = (remotes: unknown, target: Set<string>): void => {
  if (!remotes) return;

  if (Array.isArray(remotes)) {
    for (const entry of remotes) {
      if (!entry) continue;
      if (Array.isArray(entry)) {
        const [name] = entry;
        if (typeof name === 'string') target.add(name);
        continue;
      }
      if (typeof entry === 'object') {
        const maybeName = (entry as { name?: unknown; alias?: unknown }).name;
        const maybeAlias = (entry as { alias?: unknown }).alias;
        if (typeof maybeName === 'string') target.add(maybeName);
        if (typeof maybeAlias === 'string') target.add(maybeAlias);
      }
    }
    return;
  }

  if (typeof remotes === 'object') {
    for (const key of Object.keys(remotes as Record<string, unknown>)) {
      target.add(key);
    }
  }
};

const collectFederationRemoteNames = (
  plugins: unknown[] | undefined,
  target: Set<string>,
): void => {
  target.clear();
  if (!plugins) return;

  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== 'object') continue;
    const ctorName = (plugin as { constructor?: { name?: string } }).constructor
      ?.name;
    if (ctorName !== 'ModuleFederationPlugin') continue;

    const options =
      (plugin as { _options?: unknown })._options ??
      (plugin as { options?: unknown }).options;
    if (!options || typeof options !== 'object') continue;

    addRemoteNames((options as { remotes?: unknown }).remotes, target);
  }
};

const isFederationRemoteRequest = (
  request: string,
  remoteNames: Set<string>,
): boolean => {
  if (!remoteNames.size) return false;

  for (const name of remoteNames) {
    if (request === name || request.startsWith(`${name}/`)) {
      return true;
    }
  }

  return false;
};

export const shouldKeepBundledForFederation = (
  request: string,
  remoteNames?: Set<string>,
): boolean => {
  // Module Federation runtimes can generate "loader-style" requests that embed
  // inline JS via a `data:` URL (e.g. `something!=!data:text/javascript,...`).
  // Externalizing those breaks because Node can't resolve them via require/import.
  if (/!=!data:text\/javascript(?:;|,)/i.test(request)) {
    return true;
  }

  // Keep MF runtime packages bundled when federation is enabled. They participate
  // in runtime bootstrapping and may be referenced through loader-style specifiers.
  if (request.startsWith('@module-federation/')) {
    return true;
  }

  // Webpack/Rspack Module Federation container reference request.
  if (request.startsWith('webpack/container/reference/')) {
    return true;
  }

  if (remoteNames && isFederationRemoteRequest(request, remoteNames)) {
    return true;
  }

  return false;
};

const createFederationExternalBypass = (
  remoteNames: Set<string>,
): ((
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void) => {
  return function federationExternalBypass({ request }, callback) {
    if (!request || !shouldKeepBundledForFederation(request, remoteNames)) {
      return callback();
    }

    // `false` means: stop evaluating remaining externals and keep bundled.
    return callback(undefined, false);
  };
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
            const federationRemoteNames = new Set<string>();
            collectFederationRemoteNames(
              rspackConfig.plugins as unknown[] | undefined,
              federationRemoteNames,
            );
            rspackConfig.externals = castArray(rspackConfig.externals) || [];
            rspackConfig.externals.unshift(
              createFederationExternalBypass(federationRemoteNames),
            );

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
