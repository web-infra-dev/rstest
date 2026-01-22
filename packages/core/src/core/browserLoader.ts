import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListCommandResult,
} from '../types';
import { color, logger } from '../utils';

export type { BrowserTestRunOptions, BrowserTestRunResult } from '../types';

/**
 * Type definition for the @rstest/browser package exports.
 */
export interface BrowserModule {
  runBrowserTests: (
    context: unknown,
    options?: BrowserTestRunOptions,
  ) => Promise<BrowserTestRunResult | void>;
  listBrowserTests: (context: unknown) => Promise<{
    list: ListCommandResult[];
    close: () => Promise<void>;
  }>;
}

export interface LoadBrowserModuleOptions {
  /**
   * List of project root directories to try resolving @rstest/browser from.
   * This allows resolving from project-specific node_modules in monorepo setups.
   */
  projectRoots?: string[];
}

/**
 * Load @rstest/browser package with version validation.
 * Throws an error if the package is not installed or version mismatches.
 *
 * Resolution strategy (in order):
 * 1. Try to resolve from each project root (for monorepo with per-project dependencies)
 * 2. Try to resolve from user's cwd (for standalone projects)
 * 3. Fall back to resolve from @rstest/core's location (for workspace setups)
 */
export async function loadBrowserModule(
  options: LoadBrowserModuleOptions = {},
): Promise<BrowserModule> {
  const coreVersion = RSTEST_VERSION;
  const { projectRoots = [] } = options;

  let browserModule: BrowserModule;
  let browserVersion: string;

  // Build resolution bases list with project roots first
  const resolutionBases = [
    // Strategy 1: Resolve from each project root (for monorepo with per-project dependencies)
    ...projectRoots.map(
      (projectRoot) => pathToFileURL(`${projectRoot}/package.json`).href,
    ),
    // Strategy 2: Resolve from user's cwd (for standalone projects)
    pathToFileURL(`${process.cwd()}/package.json`).href,
    // Strategy 3: Resolve from @rstest/core's location (for workspace setups)
    import.meta.url,
  ];

  // Deduplicate resolution bases to avoid redundant attempts
  const uniqueBases = [...new Set(resolutionBases)];

  for (const base of uniqueBases) {
    try {
      const userRequire = createRequire(base);
      const browserPath = userRequire.resolve('@rstest/browser');
      const browserPkgPath = userRequire.resolve(
        '@rstest/browser/package.json',
      );

      browserModule = await import(pathToFileURL(browserPath).href);
      const browserPkg = userRequire(browserPkgPath);
      browserVersion = browserPkg.version;

      // Successfully resolved, validate version and return
      if (browserVersion !== coreVersion) {
        logger.error(
          `\n${color.red('Error:')} Version mismatch between ${color.cyan('@rstest/core')} and ${color.cyan('@rstest/browser')}.\n`,
        );
        logger.error(
          `  @rstest/core version:    ${color.yellow(coreVersion)}\n` +
            `  @rstest/browser version: ${color.yellow(browserVersion)}\n`,
        );
        logger.error(
          `Please ensure both packages have the same version:\n\n  ${color.cyan(`npm install @rstest/browser@${coreVersion}`)}\n`,
        );
        process.exit(1);
      }

      return browserModule!;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (
        err.code === 'ERR_MODULE_NOT_FOUND' ||
        err.code === 'MODULE_NOT_FOUND'
      ) {
        continue; // Try next resolution strategy
      }
      throw error;
    }
  }

  // All resolution strategies failed
  logger.error(
    `\n${color.red('Error:')} Browser mode requires ${color.cyan('@rstest/browser')} to be installed.\n`,
  );
  logger.error(
    `Please install it with:\n\n  ${color.cyan(`npm install @rstest/browser@${coreVersion}`)}\n`,
  );
  logger.error(
    `Or if using pnpm:\n\n  ${color.cyan(`pnpm add @rstest/browser@${coreVersion}`)}\n`,
  );
  process.exit(1);
}
