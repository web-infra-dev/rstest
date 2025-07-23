import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { NormalizedConfig } from '../../types';
import { castArray, NODE_BUILTINS } from '../../utils';

const autoExternalNodeModules: (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void = ({ context, request, dependencyType, getResolve }, callback) => {
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
      dependencyType === 'commonjs' ? 'commonjs' : 'import',
    );
  };

  const resolver = getResolve?.();

  if (!resolver) {
    return callback();
  }

  resolver(context!, request, (err, resolvePath) => {
    if (err) {
      // ignore resolve error
      return callback();
    }

    if (resolvePath && /node_modules/.test(resolvePath)) {
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

  const isNodeBuiltin = NODE_BUILTINS.some((builtin) => {
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

export const pluginExternal: (
  testEnvironment: NormalizedConfig['testEnvironment'],
) => RsbuildPlugin = (testEnvironment) => ({
  name: 'rstest:external',
  setup: (api) => {
    api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig }) => {
      return mergeRsbuildConfig(config, {
        output: {
          externals:
            testEnvironment === 'node' ? [autoExternalNodeModules] : undefined,
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
    });
  },
});
