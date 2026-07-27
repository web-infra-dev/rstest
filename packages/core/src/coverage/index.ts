import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { RsbuildPlugin } from '@rsbuild/core';
import { color, logger } from '../utils';
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
export { resolveAndMergeRawCoverage } from './resolveRawCoverage';

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
  options: NormalizedCoverageOptions,
  root: string,
): Promise<CoverageProvider | null> {
  if (!options.enabled) {
    return null;
  }

  if (!options.provider || CoverageProviderMap[options.provider]) {
    const { CoverageProvider } = await loadCoverageProvider(options, root);
    return new CoverageProvider(options, root);
  }

  throw new Error(`Unknown coverage provider: ${options.provider}`);
}

/**
 * The `Coverage enabled with <provider>` banner. Printed once per run, either
 * alongside provider creation or — on the browser-only watch path, which defers
 * provider creation until the session ends — up front on its own.
 */
export function logCoverageEnabled(options: NormalizedCoverageOptions): void {
  logger.log(
    ` ${color.gray('Coverage enabled with')} %s\n`,
    color.yellow(options.provider),
  );
}

/**
 * Create the coverage provider when coverage is enabled and print the
 * {@link logCoverageEnabled} banner. Returns null when disabled.
 */
export async function createCoverageProviderWithLog(
  options: NormalizedCoverageOptions,
  root: string,
): Promise<CoverageProvider | null> {
  const coverageProvider = await createCoverageProvider(options, root);
  if (coverageProvider) {
    logCoverageEnabled(options);
  }
  return coverageProvider;
}
