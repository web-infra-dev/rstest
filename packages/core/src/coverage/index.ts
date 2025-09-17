import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { RsbuildPlugin } from '@rsbuild/core';
import type { CoverageOptions, CoverageProvider } from '../types/coverage';
import { color } from '../utils';
export const CoverageProviderMap: Record<string, string> = {
  istanbul: '@rstest/coverage-istanbul',
};

export const loadCoverageProvider = async (
  options: CoverageOptions,
  root: string,
): Promise<{
  CoverageProvider: typeof CoverageProvider;
  pluginCoverage: (options: CoverageOptions) => RsbuildPlugin;
}> => {
  const rootPath = pathToFileURL(root).toString();

  const moduleName = CoverageProviderMap[options.provider || 'istanbul'];
  if (!moduleName) {
    throw new Error(`Unknown coverage provider: ${options.provider}`);
  }
  try {
    const require = createRequire(rootPath);
    const modulePath = require.resolve(moduleName, {
      paths: [rootPath],
    });
    const { pluginCoverage, CoverageProvider } = await import(
      pathToFileURL(modulePath).toString()
    );
    return {
      pluginCoverage,
      CoverageProvider,
    };
  } catch {
    const error = new Error(
      `Failed to load coverage provider module: ${color.cyan(moduleName)} in ${color.underline(root)}, please make sure it is installed.\n`,
    );
    error.stack = '';
    throw error;
  }
};

export async function createCoverageProvider(
  options: CoverageOptions,
  root: string,
): Promise<CoverageProvider | null> {
  if (!options.enabled) {
    return null;
  }

  if (!options.provider || CoverageProviderMap[options.provider]) {
    const { CoverageProvider } = await loadCoverageProvider(options, root);
    return new CoverageProvider(options);
  }

  throw new Error(`Unknown coverage provider: ${options.provider}`);
}
