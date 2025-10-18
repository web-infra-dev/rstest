import { isBuiltin } from 'node:module';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import {
  ADDITIONAL_NODE_BUILTINS,
  addRequestQuery,
  castArray,
  parseRstestQuery,
} from '../../utils';

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
) => {
  const createAutoExternalNodeModules = (shouldSupportQuery: boolean) => {
    return (
      data: Rspack.ExternalItemFunctionData,
      callback: (
        err?: Error,
        result?: Rspack.ExternalItemValue,
        type?: Rspack.ExternalsType,
      ) => void,
    ) => {
      const {
        context: resolveContext,
        request,
        dependencyType,
        getResolve,
      } = data;

      if (!request) {
        return callback();
      }

      if (request.startsWith('@swc/helpers/')) {
        // @swc/helper is a special case (Load by require but resolve to esm)
        return callback();
      }

      const doExternal = (externalPath: string = request) => {
        callback(
          undefined,
          externalPath,
          dependencyType === 'commonjs' ? 'commonjs' : 'module-import',
        );
      };

      const resolver = getResolve?.();

      if (!resolver) {
        return callback();
      }

      const { isActualImport, cleanedRequest } = parseRstestQuery(request);

      resolver(resolveContext!, cleanedRequest, (err, resolvePath) => {
        if (err) {
          // ignore resolve error
          return callback();
        }

        if (resolvePath && /node_modules/.test(resolvePath)) {
          if (isActualImport && shouldSupportQuery) {
            return doExternal(
              addRequestQuery(resolvePath, { rstest: 'importActual' }),
            );
          }
          return doExternal(resolvePath);
        }
        return callback();
      });
    };
  };

  return {
    name: 'rstest:external',
    setup: (api) => {
      api.modifyEnvironmentConfig(
        async (config, { mergeEnvironmentConfig, name }) => {
          const {
            normalizedConfig: { testEnvironment, importActualMethods },
          } = context.projects.find((p) => p.environmentName === name)!;
          const shouldSupportQuery =
            importActualMethods?.includes('query') ?? false;
          return mergeEnvironmentConfig(config, {
            output: {
              externals:
                testEnvironment === 'node'
                  ? [createAutoExternalNodeModules(shouldSupportQuery)]
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
                config.externals.push(autoExternalNodeBuiltin);
              },
            },
          });
        },
      );
    },
  };
};
