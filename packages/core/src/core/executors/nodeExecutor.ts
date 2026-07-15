import { createPool } from '../../pool';
import type {
  EntryInfo,
  ExecutorCycleOutcome,
  ExecutorRunCycleOptions,
  ProjectContext,
  TestExecutor,
} from '../../types';
import type { CoverageMap, CoverageProvider } from '../../types/coverage';
import { color, logger, type TraceRun } from '../../utils';
import { ensureTestEnvironmentDependencies } from '../envDependencies';
import { isNodeProject } from '../isBrowserProject';
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

/**
 * The node side of the {@link TestExecutor} seam: the existing Rsbuild dev
 * server + worker pool, expressed as one executor the shared run loop drives.
 *
 * The extra (non-interface) members — `getPlan`, `hasNodeTestsToRun`,
 * `hasBrowserTestsToRun`, `coveragePluginLoadError`, `setCoverageProvider` —
 * exist because core resolves the plan *after* `init()` fires the node
 * `modifyRstestConfig` hooks (the §3.4 barrier) and owns the single run-scoped
 * coverage provider it injects back before the first cycle.
 */
export interface NodeExecutor extends TestExecutor {
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
   * Test paths deleted during the last cycle (watch only). `finalizeRunCycle`
   * needs these to prune reporter state; they are node-cycle-internal (from
   * `getRsbuildStats`), so core reads them here after each `runCycle`.
   */
  getLastCycleDeletedEntries(): string[];
  /**
   * Start the dev server + worker pool up front (idempotent, in-flight guarded).
   * Watch calls this after registering the dev-compile hooks so the first compile
   * fires `onAfterDevCompile` and drives the initial run; non-watch runs let
   * `runCycle` trigger it lazily.
   */
  ensureRunResources(): Promise<unknown>;
  /** The Rsbuild instance built during `init()` (drives watch dev-compile hooks). */
  getRsbuildInstance(): Awaited<ReturnType<typeof prepareRsbuild>>;
  /** Re-glob every runnable node project's test entries as a flat path list. */
  globTestEntries(): Promise<string[]>;
}

export function createNodeExecutor(
  context: Rstest,
  {
    browserProjects,
    nodeProjects,
    isWatchMode,
    getTraceRun,
  }: {
    browserProjects: ProjectContext[];
    nodeProjects: ProjectContext[];
    isWatchMode: boolean;
    /** Returns the cycle's active trace buffer (reallocated by core each cycle). */
    getTraceRun: () => TraceRun;
  },
): NodeExecutor {
  const { rootPath } = context;

  const setupFileState = createSetupFileState();
  const projectPlanState = createRunProjectPlanState({
    context,
    browserProjects,
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
  let entryFiles: string[] = [];
  let lastDeletedEntries: string[] = [];
  let didRunGlobalTeardown = false;
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

    try {
      await ensureTestEnvironmentDependencies(projects, rootPath);
    } catch (error) {
      await closeServer();
      throw error;
    }

    entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
      (acc, entry) => acc.concat(Object.values(entry.entries) || []),
      [],
    );

    const getRecommendWorkerCount = (): number => {
      const nodeEntries = Array.from(entriesCache.entries()).filter(([key]) => {
        const project = projects.find((p) => p.environmentName === key);
        return !project || isNodeProject(project);
      });
      return nodeEntries.flatMap(
        ([_key, entry]) => Object.values(entry.entries) || [],
      ).length;
    };

    const recommendWorkerCount = isWatchMode
      ? Number.POSITIVE_INFINITY
      : getRecommendWorkerCount();

    const pool = await createPool({ context, recommendWorkerCount });

    runResources = { getRsbuildStats, closeServer, pool };
    return runResources;
  };

  const runCycle = async (
    opts: ExecutorRunCycleOptions,
  ): Promise<ExecutorCycleOutcome> => {
    const { buildId, mode, fileFilters, updateSnapshot } = opts;
    const buildStart = opts.buildStart ?? Date.now();
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
                  runtimeTsTransform: p.normalizedConfig.runtimeTsTransform,
                }),
              globalSetupTraceArgs,
            );
            if (!success) {
              return {
                results: [],
                testResults: [],
                errors,
                assetNames,
                getSourceMaps: () => null,
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
    lastDeletedEntries = currentDeletedEntries;

    const nodeResourceByAssetName = new Map<
      string,
      (typeof returns)[number]['getSourceMaps']
    >();
    for (const item of returns) {
      for (const assetName of item.assetNames) {
        nodeResourceByAssetName.set(assetName, item.getSourceMaps);
      }
    }

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
      duration: { buildTime, testTime },
      coverage: {
        map: mergedCoverageMap?.toJSON(),
        raw: rawCoverageResults,
      },
      resolveSourcemap: async (sourcePath) => {
        const getSourceMaps = nodeResourceByAssetName.get(sourcePath);
        const sourceMap = (await getSourceMaps?.([sourcePath]))?.[sourcePath];
        return {
          handled: sourceMap != null,
          sourcemap: sourceMap ? JSON.parse(sourceMap) : null,
        };
      },
    };
  };

  // Idempotent: the single `executors.close()` exit path may race a signal
  // handler, and closing a pool/server twice throws.
  const close = async (): Promise<void> => {
    if (didRunGlobalTeardown) {
      return;
    }
    didRunGlobalTeardown = true;
    await runGlobalTeardown();
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
    close,
    getPlan,
    hasNodeTestsToRun,
    hasBrowserTestsToRun,
    coveragePluginLoadError: () => coveragePluginLoadError,
    refreshPlan,
    setCoverageProvider: (provider) => {
      coverageProvider = provider;
    },
    getLastCycleDeletedEntries: () => lastDeletedEntries,
    // Watch: start the dev server (and pool) up front so its first compile fires
    // `onAfterDevCompile`, which drives the initial run. In non-watch runs
    // `runCycle` triggers this lazily instead.
    ensureRunResources,
    getRsbuildInstance: () => {
      if (!rsbuildInstance) {
        throw new Error('NodeExecutor.init() must run before watch wiring.');
      }
      return rsbuildInstance;
    },
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
