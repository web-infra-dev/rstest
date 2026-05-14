import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { RsbuildPlugin } from '@rsbuild/core';
import type {
  CoverageOptions,
  CoverageProvider,
  NormalizedCoverageOptions,
} from '../types/coverage';
import {
  CoverageProviderMap,
  createCoverageProviderLoadError,
  getCoverageProviderModuleName,
} from './install';
export { ensureCoverageProviderInstalled } from './install';

export const loadCoverageProvider = async (
  options: CoverageOptions,
  root: string,
): Promise<{
  CoverageProvider: typeof CoverageProvider;
  pluginCoverage: (options: CoverageOptions) => RsbuildPlugin;
}> => {
  const rootPath = pathToFileURL(root).toString();

  const moduleName = getCoverageProviderModuleName(options);
  const require = createRequire(rootPath);
  const loadProvider = async () => {
    const modulePath = require.resolve(moduleName, {
      paths: [root],
    });
    const { pluginCoverage, CoverageProvider } = await import(
      pathToFileURL(modulePath).toString()
    );
    return {
      pluginCoverage,
      CoverageProvider,
    };
  };

  try {
    return await loadProvider();
  } catch {
    throw createCoverageProviderLoadError(moduleName, root);
  }
};

/**
 * Remove stale coverage reports from a previous run. Must run on the test-run
 * lifecycle (not an rsbuild compile hook) — browser-only mode skips the node
 * rsbuild instance, and `--passWithNoTests` with no matching files races the
 * hook against generateCoverage. See https://github.com/web-infra-dev/rstest/issues/1212.
 */
export function cleanCoverageReports(options: NormalizedCoverageOptions): void {
  if (!options.enabled || !options.clean) {
    return;
  }
  if (fs.existsSync(options.reportsDirectory)) {
    fs.rmSync(options.reportsDirectory, { recursive: true });
  }
}

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
