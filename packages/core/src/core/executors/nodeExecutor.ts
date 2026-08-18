import type { RsbuildInstance } from '@rsbuild/core';
import { normalize } from 'pathe';
import { createPool } from '../../pool';
import type {
  EntryInfo,
  ExecutorCycleOutcome,
  ExecutorInvalidationCallback,
  ExecutorRunCycleOptions,
  TestExecutor,
} from '../../types';
import type {
  CoverageMap,
  CoverageProvider,
  RawCoverageResolveOptions,
} from '../../types/coverage';
import { clearScreen, color, logger, type TraceRun } from '../../utils';
import { writeBundleCoverageResults } from '../bundleCoverage';
import { ensureTestEnvironmentDependencies } from '../envDependencies';
import { claimGlobalSetupOnce, runGlobalSetup } from '../globalSetup';
import { applyOnlyFailuresSelection } from '../onlyFailures';
import type { ProjectPlan } from '../projectPlan';
import { createRsbuildServer } from '../rsbuild';
import {
  readResultsCache,
  sequenceKey,
  writeResultsCache,
} from '../resultsCache';
import type { Rstest } from '../rstest';
import type { SetupFileState } from '../setupFileState';
import { prepareTestEnvironmentModules } from '../testEnvironmentModule';
import { type SequenceHints, sortTestEntries } from '../testSequencer';

type RsbuildStats = Awaited<
  ReturnType<Awaited<ReturnType<typeof createRsbuildServer>>['getRsbuildStats']>
>;

type NodeAssetResource = Pick<
  RsbuildStats,
  'assetNames' | 'getAssetFiles' | 'getSourceMaps'
>;
type CoverageResourceLoaders = Required<RawCoverageResolveOptions>;

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
          if (content == null) continue;
          const text =
            typeof content === 'string' ? content : content.toString('utf8');
          for (const requestedName of requestedNames) {
            resources[requestedName] = text;
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
 * The node side of the {@link TestExecutor} seam: the existing Rsbuild dev
 * server + worker pool, expressed as one executor the shared run loop drives.
 * Structural, not the adapter's concrete type — `runTests` depends on this and
 * fake executors satisfy it to drive the run loop in unit tests.
 *
 * The watch loop subscribes to this executor's invalidations, so `onInvalidate`
 * — optional on the seam, for executors with no watch trigger of their own — is
 * guaranteed here. `ensureRunResources` is the one member beyond the seam, and
 * it is there because *when* the node resources come up is core's ordering
 * decision, not the executor's.
 *
 * Promoting it onto the seam as an optional `prepare?()` was considered and
 * rejected: it buys the orchestrator nothing. An optional seam member is only
 * ever *called* through a type that re-requires it — that is how `collect`,
 * `onInvalidate`, and `requestRerun` are consumed — so `runTests` would go on
 * holding this same narrowed node type, which it needs for `onInvalidate`
 * anyway. What would change is that a member only one runtime implements joins
 * the contract `@rstest/browser` is version-locked to, and that the ordering
 * obligation invariant #7 rests on (node resources up before the browser
 * launch) becomes optional-chainable — a node side that stopped implementing it
 * would compile into a silent no-op instead of a build error.
 */
export type NodeExecutor = TestExecutor &
  Required<Pick<TestExecutor, 'onInvalidate'>> & {
    /**
     * Start the dev server + worker pool up front (idempotent, in-flight
     * guarded). Watch calls this after subscribing to invalidations so the first
     * compile signals one and drives the initial run; non-watch runs let
     * `runCycle` trigger it lazily.
     */
    ensureRunResources(): Promise<unknown>;
    /**
     * Validate dependencies without starting the dev server, so mixed watch can
     * reject an invalid node project before browser globalSetup mutates state.
     */
    validateRunDependencies(): Promise<void>;
  };

/**
 * Everything the node adapter needs from the planner. `setupFileState` and
 * `globTestSourceEntries` must arrive as the planner's own objects, never copies
 * — the planner's `TestPlanner` doc records what a snapshot of either breaks.
 */
type CreateNodeExecutorOptions = {
  /** Already prepared and config-hooked by the planner. */
  rsbuildInstance: RsbuildInstance;
  setupFileState: SetupFileState;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  getPlan: () => ProjectPlan;
  /** The single run-scoped provider, or null when coverage produces none. */
  coverageProvider: CoverageProvider | null;
  isWatchMode: boolean;
  /** Returns the cycle's active trace buffer (reallocated by core each cycle). */
  getTraceRun: () => TraceRun;
  onGlobalSetupFailure?: (errors: unknown[]) => void;
};

export function createNodeExecutor(
  context: Rstest,
  {
    rsbuildInstance,
    setupFileState,
    globTestSourceEntries,
    getPlan,
    coverageProvider,
    isWatchMode,
    getTraceRun,
    onGlobalSetupFailure,
  }: CreateNodeExecutorOptions,
): NodeExecutor {
  const { rootPath } = context;

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
        cleanupTestEnvironmentModules: () => Promise<void>;
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
  let didClose = false;
  // When a dev compile starts. Paired with the compile's end into a completed
  // span below; on its own it is not a build time, because cycles are queued
  // and the wait for the queue is not build work.
  let compileStart: number | undefined;
  // A finished rebuild's measured duration, published when the compile ends and
  // claimed by exactly one cycle: the invalidation-driven one that same compile
  // queued. Publishing at the end rather than the start keeps a cycle running
  // mid-compile from reporting an unfinished rebuild's elapsed time, and the
  // claim being restricted to invalidation-driven cycles keeps a shortcut rerun
  // that was already sitting in the queue from taking the rebuild's span with it
  // when it dispatches first.
  let pendingBuildTime: number | undefined;

  const validateRunDependencies = (): Promise<void> => {
    runDependencyValidationPromise ??= ensureTestEnvironmentDependencies(
      getPlan().nodeProjectsToRun,
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
    const { nodeProjectsToRun: projects, entriesCache } = getPlan();
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

    let testEnvironmentModules:
      Awaited<ReturnType<typeof prepareTestEnvironmentModules>> | undefined;
    try {
      // Watch projects stay prepared even before they have entries: adding a
      // matching file must reuse the existing pool with the correct dependency.
      testEnvironmentModules = await prepareTestEnvironmentModules({
        projects,
        rootPath,
      });

      entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
        (acc, entry) => acc.concat(Object.values(entry.entries) || []),
        [],
      );

      const pool = await createPool({
        context,
        testEnvironmentModules: testEnvironmentModules.modules,
      });

      runResources = {
        getRsbuildStats,
        closeServer,
        pool,
        cleanupTestEnvironmentModules: testEnvironmentModules.cleanup,
      };
      return runResources;
    } catch (error) {
      try {
        await closeServer();
      } finally {
        await testEnvironmentModules?.cleanup();
      }
      throw error;
    }
  };

  const runCycle = async (
    opts: ExecutorRunCycleOptions,
  ): Promise<ExecutorCycleOutcome> => {
    const { buildId, mode, fileFilters, fromInvalidation, updateSnapshot } =
      opts;
    // Consume-once, and only by a cycle a rebuild triggered: a shortcut-driven
    // rerun compiles nothing, so it reports its own span and leaves a published
    // one for the cycle whose compile produced it, wherever in the queue that
    // cycle sits.
    let rebuildTime: number | undefined;
    if (fromInvalidation) {
      rebuildTime = pendingBuildTime;
      pendingBuildTime = undefined;
    }
    const cycleStart = Date.now();
    const { getRsbuildStats, pool } = await ensureRunResources();
    const { nodeProjectsToRun: projects } = getPlan();

    let testStart: number | undefined;
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];

    // `stateManager.reset()` is owned by core (top-of-run for non-watch, and
    // `prepareWatchCycleState` per watch cycle), never here.
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
            try {
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
                  runGlobalSetup(context, {
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
                onGlobalSetupFailure?.(errors ?? []);
                return {
                  results: [],
                  testResults: [],
                  bundleCoverage: [],
                  errors,
                  assetNames,
                  getAssetFiles,
                  getSourceMaps,
                };
              }
            } catch (error) {
              onGlobalSetupFailure?.([error]);
              throw error;
            }
          }

          const sortedEntries = sortTestEntries(
            selectedEntries,
            sequenceHints,
            (testPath) => sequenceKey(p.name, rootPath, testPath),
          );

          currentEntries.push(...sortedEntries);
          const { results, testResults, bundleCoverage } = await pool.runTests({
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
            bundleCoverage,
            assetNames,
            getAssetFiles,
            getSourceMaps,
          };
        };

        return { p, finalEntries, execute };
      }),
    );

    const isExplicitlyScoped =
      fileFilters !== undefined || context.fileFilters !== undefined;
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

    const workerCleanupErrors = !isWatchMode
      ? await pool.cleanupWorkerFixtures()
      : context.normalizedConfig.isolate === false
        ? await pool.drainWorkerStopErrors()
        : [];

    await writeBundleCoverageResults(
      rootPath,
      returns.flatMap((result) => result.bundleCoverage),
    );

    // A cycle no rebuild triggered measures its own build: the span from
    // dispatch to the moment the first test starts.
    testStart ??= Date.now();
    const buildTime = rebuildTime ?? testStart - cycleStart;
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
      errors: [
        ...returns.flatMap((r) => r.errors || []),
        ...workerCleanupErrors,
      ],
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
   * hooks are wired here rather than in the orchestrator: the rebuild-start
   * screen clear and the compile's own start have to land when the compile
   * begins, a moment only this side observes (the callback fires after it).
   *
   * `onAfterDevCompile` returns the cycle rather than signalling and moving on,
   * and unlike the browser transport it has to. The affected-entry set does not
   * ride on the hook: the cycle pulls it, and the pull is destructive —
   * `calcEntriesToRerun` diffs the dev server's stats against a per-environment
   * baseline that `applyWatchInvalidation` advances in the same call, so a
   * compile's changes can be consumed exactly once. Holding the hook is what
   * keeps a second compile from starting before this one's changes have been
   * consumed, since the bundler starts none while it is pending. Signal and
   * return, and two compiles land against one baseline: a single pull takes both
   * their changes and the other cycle diffs a baseline already past them,
   * reporting "No test files need re-run" for an edit that was real. Which cycle
   * consumes the changes is a separate question the hook does not answer — one
   * queued ahead of the rebuild's can, and `canFold` in `watchSession.ts` records
   * that as an accepted cost. So the await is not back-pressure and cannot go for
   * the reason the browser side's went — see
   * {@link ExecutorInvalidationCallback} for what holding it costs and the
   * shape that would close it.
   */
  const onInvalidate = (cb: ExecutorInvalidationCallback): void => {
    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      compileStart = Date.now();
      if (!isFirstCompile) {
        clearScreen();
      }
    });
    rsbuildInstance.onAfterDevCompile(({ isFirstCompile }) => {
      if (compileStart !== undefined) {
        pendingBuildTime = Date.now() - compileStart;
        compileStart = undefined;
      }
      return cb({ isFirstBuild: isFirstCompile });
    });
  };

  // Idempotent: the single `executors.close()` exit path may race a signal
  // handler, and closing a pool/server twice throws.
  const close = async (): Promise<void> => {
    if (didClose) {
      return;
    }
    didClose = true;
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
      try {
        await resources.pool.close();
      } finally {
        try {
          await resources.closeServer();
        } finally {
          await resources.cleanupTestEnvironmentModules();
        }
      }
    }
  };

  return {
    name: 'node',
    get projects() {
      return getPlan().nodeProjectsToRun;
    },
    // Nothing left to initialize: the planner fired the node
    // `modifyRstestConfig` hooks and resolved the plan before this executor was
    // constructed, and everything else this side owns is started by
    // `ensureRunResources` at the moment core chooses. It stays because
    // `TestExecutor.init` is required, and it has to stay empty: core calls it
    // for every node build the planner returns, a run whose node side globbed
    // no test files included, so starting the server here would boot a dev
    // server and pool that the run then never uses.
    init: async () => {},
    runCycle,
    onInvalidate,
    close,
    // Watch: start the dev server (and pool) up front so its first compile fires
    // the invalidation that drives the initial run. In non-watch runs `runCycle`
    // triggers this lazily instead.
    ensureRunResources,
    validateRunDependencies,
  };
}
