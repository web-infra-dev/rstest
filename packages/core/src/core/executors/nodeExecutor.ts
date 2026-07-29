import { normalize } from 'pathe';
import { createPool } from '../../pool';
import type {
  EntryInfo,
  ExecutorCycleOutcome,
  ExecutorInvalidationCallback,
  ExecutorRunCycleOptions,
  ProjectContext,
  TestExecutor,
} from '../../types';
import type { CoverageMap, CoverageProvider } from '../../types/coverage';
import { clearScreen, color, logger, type TraceRun } from '../../utils';
import { ensureTestEnvironmentDependencies } from '../envDependencies';
import {
  claimGlobalSetupOnce,
  runGlobalSetup,
  runGlobalTeardown,
} from '../globalSetup';
import { applyOnlyFailuresSelection } from '../onlyFailures';
import {
  createRunProjectPlanState,
  type RunProjectPlan,
  syncNodeProjects,
} from '../projectPlan';
import { createRsbuildServer, prepareRsbuild } from '../rsbuild';
import {
  readResultsCache,
  sequenceKey,
  writeResultsCache,
} from '../resultsCache';
import type { Rstest } from '../rstest';
import { createSetupFileState } from '../setupFileState';
import { type SequenceHints, sortTestEntries } from '../testSequencer';

type RsbuildStats = Awaited<
  ReturnType<Awaited<ReturnType<typeof createRsbuildServer>>['getRsbuildStats']>
>;

type NodeAssetResource = Pick<
  RsbuildStats,
  'assetNames' | 'getAssetFiles' | 'getSourceMaps'
>;
type CoverageResourceLoaders = {
  loadAssetFiles: NodeAssetResource['getAssetFiles'];
  loadSourceMaps: NodeAssetResource['getSourceMaps'];
};

export const createCoverageResourceLoaders = (
  items: NodeAssetResource[],
): CoverageResourceLoaders => {
  type Resource = Omit<NodeAssetResource, 'assetNames'>;
  type ResourceType = keyof Resource;

  const resourceByAssetName = new Map<
    string,
    { assetName: string; resource: Resource }
  >();
  const resourceEntries: { assetName: string; resource: Resource }[] = [];

  for (const item of items) {
    const resource = {
      getAssetFiles: item.getAssetFiles,
      getSourceMaps: item.getSourceMaps,
    };
    for (const assetName of item.assetNames) {
      const entry = { assetName, resource };
      resourceEntries.push(entry);
      resourceByAssetName.set(assetName, entry);
    }
  }

  for (const entry of resourceEntries) {
    const normalizedName = normalize(entry.assetName);
    const aliases = [normalizedName, normalizedName.toLowerCase()];
    let privateAlias: string | undefined;
    if (normalizedName.startsWith('/private/')) {
      privateAlias = normalizedName.slice('/private'.length);
    } else if (normalizedName.startsWith('/')) {
      privateAlias = `/private${normalizedName}`;
    }
    if (privateAlias) {
      aliases.push(privateAlias, privateAlias.toLowerCase());
    }

    for (const alias of aliases) {
      if (!resourceByAssetName.has(alias)) {
        resourceByAssetName.set(alias, entry);
      }
    }
  }

  const load = async (filenames: string[], resourceType: ResourceType) => {
    const requestsByResource = new Map<Resource, Map<string, string[]>>();

    for (const filename of new Set(filenames)) {
      const normalizedFilename = normalize(filename);
      const entry =
        resourceByAssetName.get(filename) ??
        resourceByAssetName.get(normalizedFilename) ??
        resourceByAssetName.get(normalizedFilename.toLowerCase());
      if (!entry) continue;

      const requestsByAssetName =
        requestsByResource.get(entry.resource) ?? new Map<string, string[]>();
      const requestedNames = requestsByAssetName.get(entry.assetName) ?? [];
      requestedNames.push(filename);
      requestsByAssetName.set(entry.assetName, requestedNames);
      requestsByResource.set(entry.resource, requestsByAssetName);
    }

    const resources: Record<string, string> = {};
    await Promise.all(
      Array.from(requestsByResource, async ([resource, requests]) => {
        const loaded = await resource[resourceType](
          Array.from(requests.keys()),
        );
        for (const [assetName, requestedNames] of requests) {
          const content = loaded[assetName];
          if (typeof content !== 'string') continue;
          for (const requestedName of requestedNames) {
            resources[requestedName] = content;
          }
        }
      }),
    );
    return resources;
  };

  return {
    loadAssetFiles: (filenames: string[]) => load(filenames, 'getAssetFiles'),
    loadSourceMaps: (filenames: string[]) => load(filenames, 'getSourceMaps'),
  };
};

/**
 * Everything the run orchestrator and the browser run planner need from the
 * node side *beyond* {@link TestExecutor}. Named separately so `runTests` and
 * `createBrowserRunPlanner` depend on this surface instead of the concrete node
 * adapter (and so fake executors can drive the run loop in unit tests).
 *
 * These members exist because core resolves the plan *after* `init()` fires the
 * node `modifyRstestConfig` hooks (the §3.4 barrier) and owns the single
 * run-scoped coverage provider it injects back before the first cycle.
 */
export interface NodeRunPlanAccess {
  /** The plan resolved during `init()` (browser + node runnable subsets). */
  getPlan(): RunProjectPlan;
  hasNodeTestsToRun(): boolean;
  hasBrowserTestsToRun(): boolean;
  /** A coverage-plugin load error captured while preparing Rsbuild, if any. */
  coveragePluginLoadError(): unknown;
  /**
   * Re-resolve the runnable plan after browser-side `modifyRstestConfig` hooks
   * changed project configs (the mixed-run browser discovery boot can add test
   * files to an otherwise-empty browser project), keeping the Rsbuild project
   * set in sync. Only meaningful after `init()`.
   */
  refreshPlan(): Promise<void>;
  /** Core injects the single run-scoped provider after it reads the plan. */
  setCoverageProvider(provider: CoverageProvider | null): void;
  /**
   * Start the dev server + worker pool up front (idempotent, in-flight guarded).
   * Watch calls this after subscribing to invalidations so the first compile
   * signals one and drives the initial run; non-watch runs let `runCycle`
   * trigger it lazily.
   */
  ensureRunResources(): Promise<unknown>;
  /**
   * Validate dependencies without starting the dev server, so mixed watch can
   * reject an invalid node project before browser globalSetup mutates state.
   */
  validateRunDependencies(): Promise<void>;
  /** Re-glob every runnable node project's test entries as a flat path list. */
  globTestEntries(): Promise<string[]>;
}

/**
 * The node side of the {@link TestExecutor} seam: the existing Rsbuild dev
 * server + worker pool, expressed as one executor the shared run loop drives.
 * The watch loop subscribes to this executor's invalidations, so `onInvalidate`
 * — optional on the seam while the browser side is still host-driven — is
 * guaranteed here.
 */
export type NodeExecutor = TestExecutor &
  NodeRunPlanAccess &
  Required<Pick<TestExecutor, 'onInvalidate'>>;

export type CreateNodeExecutorOptions = {
  browserProjects: ProjectContext[];
  nodeProjects: ProjectContext[];
  isWatchMode: boolean;
  /** Returns the cycle's active trace buffer (reallocated by core each cycle). */
  getTraceRun: () => TraceRun;
};

export function createNodeExecutor(
  context: Rstest,
  {
    browserProjects,
    nodeProjects,
    isWatchMode,
    getTraceRun,
  }: CreateNodeExecutorOptions,
): NodeExecutor {
  const { rootPath } = context;

  const setupFileState = createSetupFileState();
  const projectPlanState = createRunProjectPlanState({
    context,
    isWatchMode,
  });
  const { globTestSourceEntries, resolveRunnableProjects } = projectPlanState;

  let coveragePluginLoadError: unknown;
  let coverageProvider: CoverageProvider | null = null;

  // Set during init().
  let rsbuildInstance: Awaited<ReturnType<typeof prepareRsbuild>> | undefined;
  // Lazily created on first runCycle (so a run with no node tests to run never
  // pays for a server + pool — the browser-only cold-start path).
  let runResources:
    | {
        getRsbuildStats: (options: {
          environmentName: string;
          fileFilters?: string[];
        }) => Promise<RsbuildStats>;
        closeServer: () => Promise<void>;
        pool: Awaited<ReturnType<typeof createPool>>;
      }
    | undefined;
  // In-flight guard: in watch mode the dev server's first compile fires
  // `onAfterDevCompile` -> core's `run()` -> `runCycle` -> `ensureRunResources`
  // *before* the initial `ensureRunResources` (which starts that server) has
  // returned. Memoizing the promise makes the re-entrant call await the same
  // start instead of creating a second server + pool.
  let runResourcesPromise:
    Promise<NonNullable<typeof runResources>> | undefined;
  let runDependencyValidationPromise: Promise<void> | undefined;
  let entryFiles: string[] = [];
  let didRunGlobalTeardown = false;
  // Set when a dev compile starts, consumed by the cycle that compile triggers,
  // so its reported build time spans the rebuild instead of starting at dispatch.
  let pendingBuildStart: number | undefined;
  // The Rsbuild project set assembled during init(); refreshPlan() keeps it in
  // sync with re-resolved plans.
  let rsbuildProjects: ProjectContext[] = [];

  const getPlan = (): RunProjectPlan => projectPlanState.getPlan();
  const hasNodeTestsToRun = (): boolean =>
    getPlan().nodeProjectsToRun.length > 0;
  const hasBrowserTestsToRun = (): boolean =>
    getPlan().browserProjectsToRun.length > 0;

  const init = async (): Promise<void> => {
    const plan = await resolveRunnableProjects({ silentShardMessage: true });
    const plannedNodeSourceNames = new Set(
      plan.nodeProjectsToRun.map(
        (project) =>
          project._environmentGroup?.sourceEnvironmentName ??
          project.environmentName,
      ),
    );
    rsbuildProjects = [
      ...plan.nodeProjectsToRun,
      ...nodeProjects.filter(
        (project) => !plannedNodeSourceNames.has(project.environmentName),
      ),
    ];
    context.projects = [...browserProjects, ...rsbuildProjects];

    rsbuildInstance = await prepareRsbuild({
      context,
      globTestSourceEntries,
      setupFileState,
      targetProjects: rsbuildProjects,
      onCoveragePluginLoadError: (error) => {
        coveragePluginLoadError = error;
      },
      getSetupFileProjects: () => ({
        setupProjects: projectPlanState.getPlan().nodeProjectsToRun,
        globalSetupProjects: context.projects,
      }),
      onModifyRstestConfigApplied: async () => {
        const refreshed = await resolveRunnableProjects({
          strictEnvironmentComments: true,
        });
        syncNodeProjects(rsbuildProjects, refreshed.nodeProjectsToRun);
      },
      onRsbuildConfigResolved: projectPlanState.validateEnvironmentComments,
    });

    if (nodeProjects.length) {
      await rsbuildInstance.initConfigs({ action: 'dev' });
    }
  };

  const refreshPlan = async (): Promise<void> => {
    const plan = await resolveRunnableProjects({
      silentShardMessage: true,
      strictEnvironmentComments: true,
    });
    syncNodeProjects(rsbuildProjects, plan.nodeProjectsToRun);
  };

  const validateRunDependencies = (): Promise<void> => {
    runDependencyValidationPromise ??= ensureTestEnvironmentDependencies(
      projectPlanState.getPlan().nodeProjectsToRun,
      rootPath,
    );
    return runDependencyValidationPromise;
  };

  const ensureRunResources = (): Promise<NonNullable<typeof runResources>> => {
    if (!runResourcesPromise) {
      runResourcesPromise = createRunResources();
    }
    return runResourcesPromise;
  };

  const createRunResources = async (): Promise<
    NonNullable<typeof runResources>
  > => {
    if (!rsbuildInstance) {
      throw new Error('NodeExecutor.init() must run before runCycle().');
    }

    const { nodeProjectsToRun: projects, entriesCache } =
      projectPlanState.getPlan();
    await validateRunDependencies();
    const { getRsbuildStats, closeServer } = await createRsbuildServer({
      inspectedConfig: {
        ...context.normalizedConfig,
        projects: projects.map((p) => p.normalizedConfig),
      },
      isWatchMode,
      globTestSourceEntries,
      setupFiles: setupFileState.setupFiles,
      globalSetupFiles: setupFileState.globalSetupFiles,
      rsbuildInstance,
      rootPath,
    });

    entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
      (acc, entry) => acc.concat(Object.values(entry.entries) || []),
      [],
    );

    const pool = await createPool({ context });

    runResources = { getRsbuildStats, closeServer, pool };
    return runResources;
  };

  const runCycle = async (
    opts: ExecutorRunCycleOptions,
  ): Promise<ExecutorCycleOutcome> => {
    const { buildId, mode, fileFilters, updateSnapshot } = opts;
    // Consume-once: only the cycle a rebuild triggered may claim that rebuild's
    // start. A shortcut-driven rerun compiles nothing and times itself from now.
    const buildStart = pendingBuildStart ?? Date.now();
    pendingBuildStart = undefined;
    const { getRsbuildStats, pool } = await ensureRunResources();
    const { nodeProjectsToRun: projects } = projectPlanState.getPlan();

    let testStart: number | undefined;
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];

    // `stateManager.reset()` is owned by core (top-of-cycle for non-watch, and
    // `prepareWatchRerunState` per watch rerun), never here.
    context.stateManager.testFiles = isWatchMode ? undefined : entryFiles;

    const resultsCache = await readResultsCache(rootPath);
    const sequenceHints: SequenceHints = new Map(
      Object.entries(resultsCache?.files ?? {}),
    );

    const mergedCoverageMap: CoverageMap | undefined = coverageProvider
      ? coverageProvider.createCoverageMap()
      : undefined;
    const rawCoverageResults: unknown[] = [];

    const traceRun = getTraceRun();
    const { span } = traceRun;

    const projectPlans = await Promise.all(
      projects.map(async (p) => {
        const {
          assetNames,
          entries,
          setupEntries,
          globalSetupEntries,
          getAssetFiles,
          getSourceMaps,
          affectedEntries,
          deletedEntries,
        } = await span(
          'host:get-rsbuild-stats',
          'host',
          () =>
            getRsbuildStats({
              environmentName: p.environmentName,
              fileFilters,
            }),
          { project: p.name, testPath: '<project>' },
        );

        testStart ??= Date.now();

        currentDeletedEntries.push(...deletedEntries);

        let finalEntries: EntryInfo[] = entries;
        if (mode === 'on-demand') {
          if (affectedEntries.length === 0) {
            logger.debug(
              color.yellow(
                `No test files need re-run in project(${p.environmentName}).`,
              ),
            );
          } else {
            logger.debug(
              color.yellow(
                `Test files to re-run in project(${p.environmentName}):\n`,
              ) +
                affectedEntries.map((e) => e.testPath).join('\n') +
                '\n',
            );
          }
          finalEntries = affectedEntries;
        } else {
          logger.debug(
            color.yellow(
              fileFilters?.length
                ? `Run filtered tests in project(${p.environmentName}).\n`
                : `Run all tests in project(${p.environmentName}).\n`,
            ),
          );
        }

        const execute = async (selectedEntries: EntryInfo[]) => {
          if (
            claimGlobalSetupOnce(
              p,
              selectedEntries.length,
              globalSetupEntries.length,
            )
          ) {
            const files = globalSetupEntries.flatMap((e) => e.files!);
            const globalSetupTraceArgs = {
              project: p.name,
              testPath: '<globalSetup>',
            };
            const [assetFiles, sourceMaps] = await span(
              'host:global-setup-assets',
              'host',
              () => Promise.all([getAssetFiles(files), getSourceMaps(files)]),
              globalSetupTraceArgs,
            );

            const { success, errors } = await span(
              'host:global-setup',
              'host',
              () =>
                runGlobalSetup({
                  globalSetupEntries,
                  assetFiles,
                  sourceMaps,
                  interopDefault: true,
                  outputModule: p.outputModule,
                  federation: p.normalizedConfig.federation,
                }),
              globalSetupTraceArgs,
            );
            if (!success) {
              return {
                results: [],
                testResults: [],
                errors,
                assetNames,
                getAssetFiles,
                getSourceMaps,
              };
            }
          }

          const sortedEntries = sortTestEntries(
            selectedEntries,
            sequenceHints,
            (testPath) => sequenceKey(p.name, rootPath, testPath),
          );

          currentEntries.push(...sortedEntries);
          const { results, testResults } = await pool.runTests({
            entries: sortedEntries,
            assetNames,
            getSourceMaps,
            setupEntries,
            getAssetFiles,
            project: p,
            buildId,
            updateSnapshot,
            onCoverageResult: (coverage) => mergedCoverageMap?.merge(coverage),
            onRawCoverageResult: (coverage) =>
              rawCoverageResults.push(coverage),
            onTraceEvents: traceRun.onEvents,
            traceSpan: span,
          });

          return {
            results,
            testResults,
            assetNames,
            getAssetFiles,
            getSourceMaps,
          };
        };

        return { p, finalEntries, execute };
      }),
    );

    const isExplicitlyScoped = !!(
      fileFilters?.length || context.fileFilters?.length
    );
    if (
      context.normalizedConfig.onlyFailures &&
      !isWatchMode &&
      !context.relatedMode &&
      !context.normalizedConfig.testNamePattern &&
      mode !== 'on-demand' &&
      !isExplicitlyScoped
    ) {
      applyOnlyFailuresSelection(projectPlans, {
        resultsCache,
        sequenceHints,
        rootPath,
      });
    }

    const returns = await Promise.all(
      projectPlans.map((plan) => plan.execute(plan.finalEntries)),
    );

    testStart ??= buildStart;
    const buildTime = testStart - buildStart;
    const testTime = Date.now() - testStart;

    const coverageResourceLoaders = createCoverageResourceLoaders(returns);

    // Persist node results for next-run ordering. Skip partial runs
    // (`testNamePattern` narrows within files; a bail abort synthesizes skips)
    // so the perf-first cache is never poisoned. This is node-internal and does
    // not depend on the shared finalize, so it stays here.
    const bailLimit = context.normalizedConfig.bail;
    const bailAborted =
      bailLimit > 0 &&
      context.stateManager.getCountOfFailedTests() >= bailLimit;
    if (!context.normalizedConfig.testNamePattern && !bailAborted) {
      await writeResultsCache(
        rootPath,
        returns.flatMap((r) => r.results),
        currentDeletedEntries,
      );
    }

    return {
      results: returns.flatMap((r) => r.results),
      testResults: returns.flatMap((r) => r.testResults),
      errors: returns.flatMap((r) => r.errors || []),
      testPaths: currentEntries.map((e) => e.testPath),
      deletedTestPaths: currentDeletedEntries,
      duration: { buildTime, testTime },
      coverage: {
        map: mergedCoverageMap?.toJSON(),
        raw: rawCoverageResults,
        loadAssetFiles: coverageResourceLoaders.loadAssetFiles,
        loadSourceMaps: coverageResourceLoaders.loadSourceMaps,
      },
      resolveSourcemap: async (sourcePath) => {
        const sourceMap = (
          await coverageResourceLoaders.loadSourceMaps([sourcePath])
        )[sourcePath];
        return {
          handled: sourceMap != null,
          sourcemap: sourceMap ? JSON.parse(sourceMap) : null,
        };
      },
    };
  };

  /**
   * The node transport's watch signal is the dev server's compile cycle, so the
   * hooks are wired here rather than in the orchestrator: both the rebuild-start
   * screen clear and the build-start timestamp have to land when the compile
   * begins, a moment only this side observes (the callback fires after it).
   * Awaiting the callback inside `onAfterDevCompile` keeps Rsbuild's compile
   * hook pending for the whole cycle — that back-pressure is what stops a
   * rebuild from starting a second cycle while one is running.
   */
  const onInvalidate = (cb: ExecutorInvalidationCallback): void => {
    if (!rsbuildInstance) {
      throw new Error('NodeExecutor.init() must run before onInvalidate().');
    }
    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      pendingBuildStart = Date.now();
      if (!isFirstCompile) {
        clearScreen();
      }
    });
    rsbuildInstance.onAfterDevCompile(async ({ isFirstCompile }) => {
      await cb({ isFirstBuild: isFirstCompile });
    });
  };

  // Idempotent: the single `executors.close()` exit path may race a signal
  // handler, and closing a pool/server twice throws.
  const close = async (): Promise<void> => {
    if (didRunGlobalTeardown) {
      return;
    }
    didRunGlobalTeardown = true;
    await runGlobalTeardown();
    if (runDependencyValidationPromise) {
      await runDependencyValidationPromise.catch(() => undefined);
    }
    // Settle an in-flight resource start first: a close racing startup (e.g. a
    // config-change restart during watch boot) must tear down the server and
    // pool that start is about to produce, not skip them.
    if (runResourcesPromise) {
      await runResourcesPromise.catch(() => undefined);
    }
    if (runResources) {
      const resources = runResources;
      runResources = undefined;
      runResourcesPromise = undefined;
      await resources.pool.close();
      await resources.closeServer();
    }
  };

  return {
    name: 'node',
    get projects() {
      return getPlan().nodeProjectsToRun;
    },
    init,
    runCycle,
    onInvalidate,
    close,
    getPlan,
    hasNodeTestsToRun,
    hasBrowserTestsToRun,
    coveragePluginLoadError: () => coveragePluginLoadError,
    refreshPlan,
    setCoverageProvider: (provider) => {
      coverageProvider = provider;
    },
    // Watch: start the dev server (and pool) up front so its first compile fires
    // the invalidation that drives the initial run. In non-watch runs `runCycle`
    // triggers this lazily instead.
    ensureRunResources,
    validateRunDependencies,
    globTestEntries: async () => {
      const projects = projectPlanState.getPlan().nodeProjectsToRun;
      const perProject = await Promise.all(
        projects.map((p) => globTestSourceEntries(p.environmentName)),
      );
      return perProject.reduce<string[]>(
        (acc, entries) => acc.concat(...Object.values(entries)),
        [],
      );
    },
  };
}
