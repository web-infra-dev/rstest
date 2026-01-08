import { isBuiltin } from 'node:module';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import { ADDITIONAL_NODE_BUILTINS, castArray } from '../../utils';

const shouldKeepBundledForFederation = (request: string): boolean => {
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

const autoExternalNodeModules: (
  outputModule: boolean,
  federation: boolean,
) => (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void =
  (outputModule, federation) =>
  ({ context, request, dependencyType, getResolve }, callback) => {
    if (!request) {
      return callback();
    }

    if (request.startsWith('@swc/helpers/') || request.endsWith('.wasm')) {
      // @swc/helper is a special case (Load by require but resolve to esm)
      return callback();
    }

    // Module Federation can generate loader-style requests (e.g.
    // `@module-federation/runtime/rspack.js!=!data:text/javascript,...`) and
    // remote specifiers (e.g. `remote/Button`) that are not resolvable in the
    // local project. When federation is enabled, those requests must stay
    // bundled so the MF runtime can handle them at runtime.
    if (federation) {
      if (shouldKeepBundledForFederation(request)) {
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
        return mergeEnvironmentConfig(config, {
          output: {
            externals:
              testEnvironment.name === 'node'
                ? [autoExternalNodeModules(outputModule, federation)]
                : undefined,
          },
          tools: {
            rspack: (config) => {
              // Make sure that externals configuration is not modified by users
              config.externals = castArray(config.externals) || [];

              if (federation) {
                // Wrap externals functions so Module Federation "loader-style"
                // requests are never externalized (they must be processed by
                // the bundler to inline the runtime).
                config.externals = config.externals.map((ext) => {
                  if (typeof ext !== 'function') return ext;
                  return (data: any, callback: any) => {
                    const req =
                      typeof data === 'string'
                        ? data
                        : data && typeof data.request === 'string'
                          ? data.request
                          : undefined;

                    if (
                      typeof req === 'string' &&
                      shouldKeepBundledForFederation(req)
                    ) {
                      return callback();
                    }

                    return (ext as any)(data, callback);
                  };
                });
              }

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
