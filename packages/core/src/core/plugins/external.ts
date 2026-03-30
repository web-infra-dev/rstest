import { isBuiltin } from 'node:module';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import type { BundleDependencyPattern } from '../../types/config';
import { ADDITIONAL_NODE_BUILTINS, castArray } from '../../utils';

const NODE_MODULES_PATH_SEGMENT = '/node_modules/';
const SCRIPT_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/;

function hasInlineLoader(request: string): boolean {
  // has inline loader in request
  // eg: ./index.vue.ts?vue&type=template&id=20040a79&ts=true!=!node_modules/rspack-vue-loader/dist/index.js
  return request.split('!').length > 1;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function stripScriptExtension(specifier: string): string {
  return specifier.replace(SCRIPT_EXTENSION_RE, '');
}

function isRelativeRequest(request: string): boolean {
  return request.startsWith('.') || request.startsWith('/');
}

function getPackageName(specifier: string): string | undefined {
  const normalizedSpecifier = normalizePath(specifier);

  if (
    !normalizedSpecifier ||
    normalizedSpecifier.startsWith('.') ||
    normalizedSpecifier.startsWith('/') ||
    normalizedSpecifier.startsWith('node:')
  ) {
    return;
  }

  const segments = normalizedSpecifier.split('/');

  if (normalizedSpecifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  }

  return segments[0];
}

function getNodeModulesSpecifierFromResolvedPath(
  resolvedPath: string,
): string | undefined {
  const normalizedResolvedPath = normalizePath(resolvedPath);
  const nodeModulesIndex = normalizedResolvedPath.lastIndexOf(
    NODE_MODULES_PATH_SEGMENT,
  );

  if (nodeModulesIndex === -1) {
    return;
  }

  return normalizedResolvedPath.slice(
    nodeModulesIndex + NODE_MODULES_PATH_SEGMENT.length,
  );
}

function patternMatchesSpecifier(
  pattern: BundleDependencyPattern,
  specifier: string,
): boolean {
  if (pattern instanceof RegExp) {
    return (
      pattern.test(specifier) || pattern.test(stripScriptExtension(specifier))
    );
  }

  if (pattern.includes('*')) {
    const escapedPattern = pattern.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedPattern.replaceAll('\\*', '.*')}$`);

    return regex.test(specifier) || regex.test(stripScriptExtension(specifier));
  }

  const patternPackageName = getPackageName(pattern);

  if (patternPackageName === pattern) {
    return specifier === pattern || specifier.startsWith(`${pattern}/`);
  }

  return (
    specifier === pattern ||
    stripScriptExtension(specifier) === stripScriptExtension(pattern)
  );
}

function matchesBundledDependency(
  request: string,
  resolvedSpecifier: string | undefined,
  bundledDependencies: BundleDependencyPattern[] | undefined,
): boolean {
  if (!bundledDependencies?.length) {
    return false;
  }

  if (
    bundledDependencies.some((pattern) =>
      patternMatchesSpecifier(pattern, request),
    )
  ) {
    return true;
  }

  if (
    resolvedSpecifier &&
    bundledDependencies.some((pattern) =>
      patternMatchesSpecifier(pattern, resolvedSpecifier),
    )
  ) {
    return true;
  }

  if (!resolvedSpecifier || !isRelativeRequest(request)) {
    return false;
  }

  const resolvedPackageName = getPackageName(resolvedSpecifier);

  if (resolvedPackageName === undefined) {
    return false;
  }

  return bundledDependencies.some((pattern) => {
    if (pattern instanceof RegExp) {
      return false;
    }

    return getPackageName(pattern) === resolvedPackageName;
  });
}

const autoExternalNodeModules: (
  outputModule: boolean,
  bundledDependencies?: BundleDependencyPattern[],
) => (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void =
  (outputModule, bundledDependencies) =>
  ({ context, request, dependencyType, getResolve }, callback) => {
    if (!request) {
      return callback();
    }

    if (
      request.startsWith('@swc/helpers/') ||
      request.endsWith('.wasm') ||
      hasInlineLoader(request)
    ) {
      // @swc/helper is a special case (Load by require but resolve to esm)
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
    if (matchesBundledDependency(request, undefined, bundledDependencies)) {
      return callback();
    }

    if (!resolver) {
      return callback();
    }

    resolver(context!, request, (err, resolvePath) => {
      if (err) {
        // ignore resolve error and external it as commonjs （it may be mocked）
        // however, we will lose the code frame info if module not found
        return callback(undefined, request, 'node-commonjs');
      }

      const resolvedSpecifier =
        typeof resolvePath === 'string'
          ? getNodeModulesSpecifierFromResolvedPath(resolvePath)
          : undefined;
      const shouldBundleByResolvedPath = matchesBundledDependency(
        request,
        resolvedSpecifier,
        bundledDependencies,
      );

      if (
        // biome-ignore lint/complexity/useOptionalChain: type error
        resolvePath &&
        resolvePath.includes(NODE_MODULES_PATH_SEGMENT) &&
        !shouldBundleByResolvedPath &&
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
        normalizedConfig: {
          testEnvironment,
          output: { bundleDependencies } = {},
        },
        outputModule,
      } = context.projects.find((p) => p.environmentName === name)!;

      const shouldExternalize =
        bundleDependencies === undefined
          ? testEnvironment.name === 'node'
          : Array.isArray(bundleDependencies)
            ? true
            : !bundleDependencies;

      return mergeEnvironmentConfig(config, {
        output: {
          externals: shouldExternalize
            ? [
                autoExternalNodeModules(
                  outputModule,
                  Array.isArray(bundleDependencies)
                    ? bundleDependencies
                    : undefined,
                ),
              ]
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
