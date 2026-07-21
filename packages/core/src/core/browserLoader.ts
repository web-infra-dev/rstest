import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ProjectContext,
  RstestContext,
  TestExecutor,
} from '../types';
import type { CoverageProvider } from '../types/coverage';
import { color, logger } from '../utils';

export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  ListBrowserTestsOptions,
} from '../types';

/**
 * Core-owned contract for the `@rstest/browser/internal` host module.
 *
 * This is the single source of truth for the core↔browser load boundary:
 * `loadBrowserModule` returns it, and `@rstest/browser`'s public entry
 * constrains its exports against it via `satisfies`. The `context` is typed
 * as {@link RstestContext} (not `unknown`) so drift between the two sides —
 * such as a dropped `options` argument — surfaces as a type error.
 */
/**
 * Options for {@link BrowserHostModule.createBrowserExecutor}. `projects` is the
 * explicit browser-project subset the plan resolved; `coverageProvider` is the
 * single run-scoped provider core owns, shared so the browser host folds its
 * per-file coverage into the same map shape the node pool produces.
 */
export interface CreateBrowserExecutorOptions extends Pick<
  BrowserTestRunOptions,
  | 'freezeShardedEntries'
  | 'filesOnly'
  | 'allowEmptyRun'
  | 'appliedModifyRstestConfigEnvironments'
> {
  projects: ProjectContext[];
  coverageProvider: CoverageProvider | null;
}

/**
 * A {@link TestExecutor} with `collect` guaranteed: the browser side is the one
 * implementation that lists through the seam (`rstest list` relies on it).
 */
export type BrowserTestExecutor = TestExecutor &
  Required<Pick<TestExecutor, 'collect'>>;

export interface BrowserHostModule {
  validateBrowserConfig: (context: RstestContext) => void;
  /**
   * The outer-seam entry point: build a {@link TestExecutor} the shared run loop
   * drives alongside the node pool. Obtained through the version-locked dynamic
   * seam so core never statically imports playwright.
   */
  createBrowserExecutor: (
    context: RstestContext,
    options: CreateBrowserExecutorOptions,
  ) => Promise<BrowserTestExecutor>;
  runBrowserTests: (
    context: RstestContext,
    options?: BrowserTestRunOptions,
  ) => Promise<BrowserTestRunResult | void>;
}

interface LoadBrowserModuleOptions {
  /**
   * List of project root directories to try resolving @rstest/browser from.
   * This allows resolving from project-specific node_modules in monorepo setups.
   */
  projectRoots?: string[];
  /**
   * When true, a missing or version-mismatched `@rstest/browser` throws instead
   * of calling `process.exit(1)`. See the `embedded` option on `createRstest`.
   */
  embedded?: boolean;
}

/**
 * Load @rstest/browser internal module with version validation.
 * Throws an error if the package is not installed or version mismatches.
 *
 * Resolution strategy (in order):
 * 1. Try to resolve from each project root (for monorepo with per-project dependencies)
 * 2. Try to resolve from user's cwd (for standalone projects)
 * 3. Fall back to resolve from @rstest/core's location (for workspace setups)
 */
export async function loadBrowserModule(
  options: LoadBrowserModuleOptions = {},
): Promise<BrowserHostModule> {
  const coreVersion = RSTEST_VERSION;
  const { projectRoots = [], embedded = false } = options;

  let browserModule: BrowserHostModule;
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
      const browserPath = userRequire.resolve('@rstest/browser/internal');
      const browserPkgPath = userRequire.resolve(
        '@rstest/browser/package.json',
      );

      // The dynamic import namespace is unknown-shaped; the runtime contract is
      // guaranteed on the `@rstest/browser` side via `satisfies BrowserHostModule`.
      browserModule = (await import(
        pathToFileURL(browserPath).href
      )) as BrowserHostModule;
      const browserPkg = userRequire(browserPkgPath);
      browserVersion = browserPkg.version;

      // Successfully resolved, validate version and return
      if (browserVersion !== coreVersion) {
        if (embedded) {
          throw new Error(
            `Version mismatch between @rstest/core (${coreVersion}) and ` +
              `@rstest/browser (${browserVersion}). Install matching versions: ` +
              `npm install @rstest/browser@${coreVersion}`,
          );
        }
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
  if (embedded) {
    throw new Error(
      `Browser mode requires @rstest/browser to be installed: ` +
        `npm install @rstest/browser@${coreVersion}`,
    );
  }
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

/**
 * Load `@rstest/browser` and build the browser side of the executor seam,
 * validating the browser config first. Shared by the run path (`runTests`) and
 * the list path (`listTests`) so both go through one browser entry point.
 */
export async function loadBrowserExecutor(
  context: RstestContext,
  browserProjects: ProjectContext[],
  coverageProvider: CoverageProvider | null,
  runOptions?: Pick<
    BrowserTestRunOptions,
    | 'freezeShardedEntries'
    | 'filesOnly'
    | 'allowEmptyRun'
    | 'appliedModifyRstestConfigEnvironments'
  >,
): Promise<BrowserTestExecutor> {
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const { validateBrowserConfig, createBrowserExecutor } =
    await loadBrowserModule({
      projectRoots,
      embedded: context.embedded,
    });
  validateBrowserConfig(context);
  return createBrowserExecutor(context, {
    projects: browserProjects,
    coverageProvider,
    ...runOptions,
  });
}
