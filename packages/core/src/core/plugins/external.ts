import { isBuiltin } from 'node:module';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import { ADDITIONAL_NODE_BUILTINS, castArray } from '../../utils';

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

const autoExternalNodeModules: (
  outputModule: boolean,
  federation: boolean,
  remoteNames: Set<string>,
) => (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void =
  (outputModule, federation, remoteNames) =>
  ({ context, request, dependencyType, getResolve }, callback) => {
    if (!request) {
      return callback();
    }

    if (request.startsWith('@swc/helpers/') || request.endsWith('.wasm')) {
      // @swc/helper is a special case (Load by require but resolve to esm)
      return callback();
    }

    // Module Federation can generate loader-style requests (e.g.
    // `@module-federation/runtime/rspack.js!=!data:text/javascript,...`) that
    // are not resolvable in the local project. When federation is enabled,
    // those requests must stay bundled so the MF runtime can handle them.
    if (federation) {
      if (
        // loader-style `!=!data:text/javascript,...` specifiers
        /!=!data:text\/javascript(?:;|,)/i.test(request) ||
        request.startsWith('@module-federation/') ||
        isFederationRemoteRequest(request, remoteNames)
      ) {
        return callback();
      }
    }

    const doExternal = (externalPath: string = request) => {
      callback(
        undefined,
        externalPath,
        dependencyType === 'commonjs'
          ? 'commonjs'
          : outputModule
            ? 'module-import'
            : 'import',
      );
    };

    const resolver = getResolve?.();

    if (!resolver) {
      return callback();
    }

    resolver(context!, request, (err, resolvePath) => {
      if (err) {
        if (federation) {
          // Keep unresolved specifiers bundled for federation; the runtime can
          // resolve them via remoteEntry.js.
          return callback();
        }

        // Ignore resolve error and external it as commonjs (it may be mocked).
        // However, we will lose the code frame info if module not found.
        return callback(undefined, request, 'node-commonjs');
      }

      if (
        // biome-ignore lint/complexity/useOptionalChain: type error
        resolvePath &&
        resolvePath.includes('node_modules') &&
        !/\.(?:ts|tsx|jsx|mts|cts)$/.test(resolvePath)
      ) {
        return doExternal(resolvePath);
      }
      return callback();
    });
  };

function autoExternalNodeBuiltin(
  { request, dependencyType }: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
): void {
  if (!request) {
    callback();
    return;
  }

  const isNodeBuiltin =
    isBuiltin(request) ||
    ADDITIONAL_NODE_BUILTINS.some((builtin) => {
      if (typeof builtin === 'string') {
        return builtin === request;
      }

      return builtin.test(request);
    });

  if (isNodeBuiltin) {
    callback(
      undefined,
      request,
      dependencyType === 'commonjs' ? 'commonjs' : 'module-import',
    );
  } else {
    callback();
  }
}

export const pluginExternal: (context: RstestContext) => RsbuildPlugin = (
  context,
) => ({
  name: 'rstest:external',
  setup: (api) => {
    api.modifyEnvironmentConfig(
      async (config, { mergeEnvironmentConfig, name }) => {
        const {
          normalizedConfig: { testEnvironment },
          outputModule,
        } = context.projects.find((p) => p.environmentName === name)!;
        const federation = Boolean(
          context.projects.find((p) => p.environmentName === name)!
            .normalizedConfig.federation,
        );
        const federationRemoteNames = new Set<string>();
        return mergeEnvironmentConfig(config, {
          output: {
            externals:
              testEnvironment.name === 'node'
                ? [
                    autoExternalNodeModules(
                      outputModule,
                      federation,
                      federationRemoteNames,
                    ),
                  ]
                : undefined,
          },
          tools: {
            rspack: (config) => {
              collectFederationRemoteNames(
                config.plugins as unknown[] | undefined,
                federationRemoteNames,
              );
              // Make sure that externals configuration is not modified by users
              config.externals = castArray(config.externals) || [];

              config.externals.unshift({
                '@rstest/core': 'global @rstest/core',
              });

              config.externalsPresets ??= {};
              config.externalsPresets.node = false;
              config.externals.unshift(autoExternalNodeBuiltin);
            },
          },
        });
      },
    );
  },
});
