import { type RsbuildPlugin, type Rspack, rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';

type ModuleNameMapperConfig = Record<string, string | string[]>;

/**
 * Replace `<rootDir>` token in the replacement path with the actual root directory.
 */
function replaceRootDir(value: string, rootDir: string): string {
  return value.replace(/<rootDir>/g, rootDir);
}

/**
 * Create NormalModuleReplacementPlugin instances for moduleNameMapper configuration.
 * This is a shared utility used by both node and browser modes.
 *
 * @returns Array of NormalModuleReplacementPlugin instances
 */
export function createModuleNameMapperPlugins(options: {
  /** The moduleNameMapper configuration */
  moduleNameMapper: ModuleNameMapperConfig;
  /** The root directory for `<rootDir>` token replacement */
  rootDir: string;
  /** The rspack instance to use for creating plugins (defaults to imported rspack) */
  rspack?: typeof rspack;
}): Rspack.WebpackPluginInstance[] {
  const {
    moduleNameMapper,
    rootDir,
    rspack: rspackInstance = rspack,
  } = options;
  const plugins: Rspack.WebpackPluginInstance[] = [];

  for (const [pattern, replacement] of Object.entries(moduleNameMapper)) {
    const resourceRegExp = new RegExp(pattern);
    const replacements = Array.isArray(replacement)
      ? replacement
      : [replacement];

    // Process each replacement with rootDir substitution
    const processedReplacements = replacements.map((r) =>
      replaceRootDir(r, rootDir),
    );

    // Use the first replacement path
    // Note: Unlike Jest, we don't try to resolve each path in order
    // because NormalModuleReplacementPlugin doesn't support async resolution
    // Users should ensure the first path exists or use a single path
    const newResource = processedReplacements[0]!;

    plugins.push(
      new rspackInstance.NormalModuleReplacementPlugin(
        resourceRegExp,
        (resource: Rspack.ResolveData) => {
          // Apply capture group replacements ($1, $2, etc.)
          const match = resource.request?.match(resourceRegExp);
          if (match) {
            let resolvedPath = newResource;
            // Replace capture group references with matched values
            for (let i = 1; i < match.length; i++) {
              resolvedPath = resolvedPath.replace(
                new RegExp(`\\$${i}`, 'g'),
                match[i] || '',
              );
            }
            resource.request = resolvedPath;
          }
        },
      ),
    );
  }

  return plugins;
}

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

const excludeExternalize: (
  moduleNameMapper: Record<string, string | string[]> | undefined,
) => (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void =
  (moduleNameMapper) =>
  ({ request }, callback) => {
    if (!request) {
      return callback();
    }

    // If request matches moduleNameMapper, don't externalize - let it be transformed
    if (matchesModuleNameMapper(request, moduleNameMapper)) {
      return callback(undefined, false);
    }
    return callback();
  };

/**
 * Apply module name mapper using rspack.NormalModuleReplacementPlugin.
 *
 * This is similar to Jest's moduleNameMapper configuration.
 * - Keys are regex patterns to match the module request
 * - Values are replacement paths (string or array of strings)
 * - Capture groups ($1, $2, etc.) are supported
 * - `<rootDir>` token is replaced with the directory containing the config file
 */
export const pluginModuleNameMapper: (context: RstestContext) => RsbuildPlugin =
  (context) => ({
    name: 'rstest:module-name-mapper',
    setup: (api) => {
      api.modifyRspackConfig((config, { environment }) => {
        const project = context.projects.find(
          (p) => p.environmentName === environment.name,
        );

        if (!project) {
          return config;
        }

        const moduleNameMapper =
          project.normalizedConfig.resolve?.moduleNameMapper;

        if (!moduleNameMapper || Object.keys(moduleNameMapper).length === 0) {
          return config;
        }

        config.plugins ??= [];

        const mapperPlugins = createModuleNameMapperPlugins({
          moduleNameMapper,
          rootDir: project.rootPath,
        });
        config.plugins.push(...mapperPlugins);

        // Make sure that externals configuration is not modified by users
        config.externals = Array.isArray(config.externals)
          ? config.externals
          : [];

        config.externals.unshift(excludeExternalize(moduleNameMapper));

        return config;
      });
    },
  });
