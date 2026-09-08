import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  InternalContext,
  InternalProjectContext,
  TestExecutor,
} from '../../types';
import type { CoverageProvider } from '../../types/coverage';
import { color } from '../../utils';

export type { BrowserTestRunOptions, BrowserTestRunResult } from '../../types';

/**
 * The subset of {@link BrowserTestRunOptions} that configures a browser
 * executor construction (as opposed to the files-only discovery boot). Single
 * source of truth for the field list: the executor options interface, the
 * `loadBrowserExecutor` argument, and the planner's option bag all derive
 * from it.
 */
export type BrowserExecutorRunOptions = Pick<
  BrowserTestRunOptions,
  | 'shardedEntries'
  | 'freezeShardedEntries'
  | 'filesOnly'
  | 'allowEmptyRun'
  | 'appliedModifyRstestConfigEnvironments'
>;

export interface BrowserExecutorLoadOptions extends BrowserExecutorRunOptions {
  /** The planner's discovery boot already validated the post-hook config. */
  configAlreadyValidated?: boolean;
}

/**
 * Options for {@link BrowserHostModule.createBrowserExecutor}. `projects` is the
 * explicit browser-project subset the plan resolved; `coverageProvider` is the
 * single run-scoped provider core owns, shared so the browser host folds its
 * per-file coverage into the same map shape the node pool produces.
 */
export interface CreateBrowserExecutorOptions extends BrowserExecutorRunOptions {
  projects: InternalProjectContext[];
  coverageProvider: CoverageProvider | null;
}

/**
 * The browser side of the seam, with the members core relies on it to implement
 * made non-optional: `collect` (`rstest list` lists through it) and the watch
 * pair `onInvalidate`/`requestRerun` (core drives every browser watch cycle
 * through them).
 */
export type BrowserTestExecutor = TestExecutor &
  Required<Pick<TestExecutor, 'collect' | 'onInvalidate' | 'requestRerun'>> & {
    /**
     * Watch only, meaningful once the initial cycle has resolved: whether the
     * host left a live session behind. A launch that found no test files, or
     * that failed before the runtime came up, opens none — and with no session
     * no trigger can ever fire, so core prints no ready banner for it.
     */
    hasWatchSession(): boolean;
  };

/**
 * Core-owned contract for the `@rstest/browser/internal` host module.
 *
 * This is the single source of truth for the core↔browser load boundary:
 * `loadBrowserModule` returns it, and `@rstest/browser`'s public entry
 * constrains its exports against it via `satisfies`. The `context` is typed
 * as {@link InternalContext} (not `unknown`) so drift between the two sides —
 * such as a dropped `options` argument — surfaces as a type error.
 */
export interface BrowserHostModule {
  validateBrowserConfig: (context: InternalContext) => void;
  /**
   * The outer-seam entry point: build a {@link TestExecutor} the shared run loop
   * drives alongside the node pool. Obtained through the version-locked dynamic
   * seam so core never statically imports playwright.
   */
  createBrowserExecutor: (
    context: InternalContext,
    options: CreateBrowserExecutorOptions,
  ) => Promise<BrowserTestExecutor>;
  /**
   * The files-only discovery boot (see {@link runBrowserDiscovery}). Runs and
   * watch reruns go through `createBrowserExecutor`, never through here.
   */
  runBrowserTests: (
    context: InternalContext,
    options?: BrowserTestRunOptions,
  ) => Promise<BrowserTestRunResult | void>;
}

function createLoadError(message: string): Error {
  const error = new Error(message);
  error.stack = '';
  return error;
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
  browserProjects: InternalProjectContext[],
): Promise<BrowserHostModule> {
  const coreVersion = RSTEST_VERSION;

  // Build resolution bases list with project roots first
  const resolutionBases = [
    // Strategy 1: Resolve from each project root (for monorepo with per-project dependencies)
    ...browserProjects.map(
      (project) => pathToFileURL(`${project.rootPath}/package.json`).href,
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
      const browserModule = (await import(
        pathToFileURL(browserPath).href
      )) as BrowserHostModule;
      const browserPkg = userRequire(browserPkgPath);
      const browserVersion: string = browserPkg.version;

      // Successfully resolved, validate version and return
      if (browserVersion !== coreVersion) {
        throw createLoadError(
          `Version mismatch between ${color.cyan('@rstest/core')} and ${color.cyan('@rstest/browser')}: @rstest/core is ${color.yellow(coreVersion)}, @rstest/browser is ${color.yellow(browserVersion)}. Install matching versions: ${color.cyan(`npm install @rstest/browser@${coreVersion}`)}`,
        );
      }

      return browserModule;
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
  throw createLoadError(
    `Browser mode requires ${color.cyan('@rstest/browser')} to be installed: ${color.cyan(`npm install @rstest/browser@${coreVersion}`)}`,
  );
}

export async function loadAndValidateBrowserModule(
  context: InternalContext,
  browserProjects: InternalProjectContext[],
): Promise<BrowserHostModule> {
  const browserModule = await loadBrowserModule(browserProjects);
  browserModule.validateBrowserConfig(context);
  return browserModule;
}

/**
 * Boot Browser Mode in files-only mode so browser `modifyRstestConfig` hooks
 * apply and the test-file set is refreshed. The sole remaining caller is the
 * config-hook discovery boot — every real run and rerun goes through
 * {@link BrowserTestExecutor}.
 */
export async function runBrowserDiscovery(
  context: InternalContext,
  browserProjects: InternalProjectContext[],
  options: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  const browserModule = await loadBrowserModule(browserProjects);
  const result = await browserModule.runBrowserTests(context, {
    ...options,
    projects: browserProjects,
  });

  // A registered Rsbuild plugin may not actually register a config hook. In
  // that case the host has no post-hook refresh at which to validate, so the
  // discovery boot must still provide the run's validation barrier itself.
  const configWasValidatedByHook = browserProjects.some((project) =>
    options.appliedModifyRstestConfigEnvironments?.has(project.environmentName),
  );
  if (!configWasValidatedByHook) {
    try {
      browserModule.validateBrowserConfig(context);
    } catch (error) {
      // The boot already built its runtime; the caller only closes it on a
      // returned result, so an invalid config must not leak the dev servers.
      await result?.close?.();
      throw error;
    }
  }
  return result;
}

/**
 * Validate the run's browser config through the version-locked seam without
 * building anything. An invalid browser config has to fail the run whether or
 * not the plan found a browser test file to launch with, and the launch is the
 * only thing that would otherwise validate it — so a run that finalizes without
 * ever loading an executor has to ask for the check itself.
 */
export async function validateBrowserRunConfig(
  context: InternalContext,
  browserProjects: InternalProjectContext[],
): Promise<void> {
  await loadAndValidateBrowserModule(context, browserProjects);
}

/**
 * Load `@rstest/browser` and build the browser side of the executor seam,
 * validating the browser config unless the planner's discovery barrier already
 * did. Shared by the run path (`runTests`) and the list path (`listTests`) so
 * both go through one browser entry point.
 */
export async function loadBrowserExecutor(
  context: InternalContext,
  browserProjects: InternalProjectContext[],
  coverageProvider: CoverageProvider | null,
  loadOptions?: BrowserExecutorLoadOptions,
): Promise<BrowserTestExecutor> {
  const { configAlreadyValidated = false, ...runOptions } = loadOptions ?? {};
  const { createBrowserExecutor } = configAlreadyValidated
    ? await loadBrowserModule(browserProjects)
    : await loadAndValidateBrowserModule(context, browserProjects);
  return createBrowserExecutor(context, {
    projects: browserProjects,
    coverageProvider,
    ...runOptions,
  });
}
