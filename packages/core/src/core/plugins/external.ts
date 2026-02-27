import { isBuiltin } from 'node:module';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import { ADDITIONAL_NODE_BUILTINS, castArray } from '../../utils';

/**
 * Check if a request matches any moduleNameMapper pattern.
 * If it does, don't externalize it - let NormalModuleReplacementPlugin handle it.
 */
const matchesModuleNameMapper = (
  request: string,
  moduleNameMapper: Record<string, string | string[]> | undefined,
): boolean => {
  if (!moduleNameMapper) return false;

  for (const pattern of Object.keys(moduleNameMapper)) {
    if (new RegExp(pattern).test(request)) {
      return true;
    }
  }
  return false;
};

const autoExternalNodeModules: (
  outputModule: boolean,
  moduleNameMapper: Record<string, string | string[]> | undefined,
) => (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void =
  (outputModule, moduleNameMapper) =>
  ({ context, request, dependencyType, getResolve }, callback) => {
    if (!request) {
      return callback();
    }

    if (request.startsWith('@swc/helpers/') || request.endsWith('.wasm')) {
      // @swc/helper is a special case (Load by require but resolve to esm)
      return callback();
    }

    // If request matches moduleNameMapper, don't externalize - let it be transformed
    if (matchesModuleNameMapper(request, moduleNameMapper)) {
      return callback();
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
        // ignore resolve error and external it as commonjs （it may be mocked）
        // however, we will lose the code frame info if module not found
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
    api.modifyEnvironmentConfig((config, { mergeEnvironmentConfig, name }) => {
      const {
        normalizedConfig: { testEnvironment, resolve },
        outputModule,
      } = context.projects.find((p) => p.environmentName === name)!;
      const moduleNameMapper = resolve?.moduleNameMapper;

      return mergeEnvironmentConfig(config, {
        output: {
          externals:
            testEnvironment.name === 'node'
              ? [autoExternalNodeModules(outputModule, moduleNameMapper)]
              : undefined,
        },
        tools: {
          rspack: (config) => {
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
    });
  },
});
