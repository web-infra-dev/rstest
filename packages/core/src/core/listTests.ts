import { createPool } from '../pool';
import type {
  FormattedError,
  ListCommandCollectOptions,
  ListCommandCollectionResult,
  ListCommandResult,
} from '../types';
import {
  claimGlobalSetupOnce,
  runGlobalSetup,
  runGlobalTeardown,
} from './globalSetup';
import {
  type BrowserGlobalSetupStageResult,
  runBrowserGlobalSetupStage,
} from './browser/globalSetupStage';
import {
  type BrowserTestExecutor,
  loadBrowserExecutor,
  validateBrowserRunConfig,
} from './browser/loader';
import { ensureTestEnvironmentDependencies } from './envDependencies';
import { createRsbuildServer } from './rsbuild';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import { createTestPlanner, type TestPlanner } from './planner';
import type { Rstest } from './rstest';
import { prepareTestEnvironmentModules } from './testEnvironmentModule';

/**
 * Collect tests from node mode projects using the planner's node build and the
 * worker pool. The plan's node subset is post-hook and empty-project-free, so
 * no dev server, dependency preparation, or pool exists for a project the plan
 * resolved out.
 */
const collectNodeTests = async ({
  context,
  planner,
}: {
  context: Rstest;
  planner: TestPlanner;
}) => {
  const nodeProjects = planner.getPlan().nodeProjectsToRun;
  const { nodeBuild } = planner;

  if (!nodeBuild || !planner.hasNodeTestsToRun()) {
    return {
      list: [],
      getSourceMap: async () => null,
      close: async () => undefined,
    };
  }

  const { rsbuildInstance, setupFileState, globTestSourceEntries } = nodeBuild;

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    globTestSourceEntries,
    globalSetupFiles: setupFileState.globalSetupFiles,
    isWatchMode: false,
    inspectedConfig: {
      ...context.normalizedConfig,
      projects: nodeProjects.map((p) => p.normalizedConfig),
    },
    setupFiles: setupFileState.setupFiles,
    rsbuildInstance,
    rootPath: context.rootPath,
  });

  let pool: Awaited<ReturnType<typeof createPool>> | undefined;
  let testEnvironmentModules:
    Awaited<ReturnType<typeof prepareTestEnvironmentModules>> | undefined;
  const closeResources = async (): Promise<void> => {
    try {
      await closeServer();
    } finally {
      try {
        await pool?.close();
      } finally {
        await testEnvironmentModules?.cleanup();
      }
    }
  };

  try {
    await ensureTestEnvironmentDependencies(nodeProjects, context.rootPath, {
      confirm: context.packageInstallerConfirm,
    });
    testEnvironmentModules = await prepareTestEnvironmentModules({
      projects: nodeProjects,
      rootPath: context.rootPath,
    });

    pool = await createPool({
      context,
      testEnvironmentModules: testEnvironmentModules.modules,
    });
    const activePool = pool;
    const updateSnapshot = context.snapshotManager.options.updateSnapshot;

    const returns = await Promise.all(
      nodeProjects.map(async (project) => {
        const {
          entries,
          setupEntries,
          globalSetupEntries,
          getSourceMaps,
          getAssetFiles,
          assetNames,
        } = await getRsbuildStats({
          environmentName: project.environmentName,
        });

        if (
          claimGlobalSetupOnce(
            project,
            entries.length,
            globalSetupEntries.length,
          )
        ) {
          const files = globalSetupEntries.flatMap((e) => e.files!);
          const assetFilesPromise = getAssetFiles(files);
          const sourceMapsPromise = getSourceMaps(files);
          const [assetFiles, sourceMaps] = await Promise.all([
            assetFilesPromise,
            sourceMapsPromise,
          ]);

          const { success, errors } = await runGlobalSetup(context, {
            globalSetupEntries,
            assetFiles,
            sourceMaps,
            interopDefault: true,
            outputModule: project.outputModule,
            federation: project.normalizedConfig.federation,
          });
          if (!success) {
            return {
              list: [],
              errors,
              assetNames,
              getSourceMaps: () => null,
            };
          }
        }

        const list = await activePool.collectTests({
          entries,
          assetNames,
          setupEntries,
          getAssetFiles,
          getSourceMaps,
          project,
          updateSnapshot,
        });

        return {
          list,
          getSourceMaps,
          assetNames,
        };
      }),
    );

    return {
      list: returns.flatMap((r) => r.list),
      errors: returns.flatMap((r) => r.errors || []),
      getSourceMap: async (name: string) => {
        const resource = returns.find((r) => r.assetNames.includes(name));
        return (await resource?.getSourceMaps([name]))?.[name];
      },
      close: async () => {
        await closeResources();
      },
    };
  } catch (error) {
    await closeResources();
    throw error;
  }
};

type PreparedBrowserCollection = {
  executor: BrowserTestExecutor;
  stage: BrowserGlobalSetupStageResult;
};

/**
 * Load the browser executor over the plan's browser subset — the same subset
 * and executor options a run would launch with, so a shard-empty or file-empty
 * browser project never boots a dev server here either — and run the browser
 * globalSetup stage. Sequenced before node collection starts so the stage's
 * context-local environment overlay reaches node workers at dispatch.
 */
const prepareBrowserCollection = async ({
  context,
  planner,
}: {
  context: Rstest;
  planner: TestPlanner;
}): Promise<PreparedBrowserCollection | undefined> => {
  if (!planner.hasBrowserTestsToRun()) {
    return undefined;
  }

  const browserProjects = planner.getBrowserProjectsToRun();
  const executor = await loadBrowserExecutor(
    context,
    browserProjects,
    null,
    planner.getExecutorRunOptions(browserProjects),
  );

  try {
    const stage = await runBrowserGlobalSetupStage(context, browserProjects, {
      entriesCache: planner.getPlan().entriesCache,
    });
    return { executor, stage };
  } catch (error) {
    // A rejected setup must still close an in-flight browser launch.
    await executor.close().catch(() => undefined);
    throw error;
  }
};

/**
 * Collect tests from browser mode projects through the executor seam.
 */
const collectBrowserTests = async (
  prepared: PreparedBrowserCollection | undefined,
): Promise<{
  errors?: FormattedError[];
  list: ListCommandResult[];
  close: () => Promise<void>;
}> => {
  if (!prepared) {
    return {
      list: [],
      close: async () => undefined,
    };
  }

  const { executor, stage } = prepared;
  const close = async () => {
    await executor.close();
  };

  if (stage.errors.length) {
    return { list: [], errors: stage.errors, close };
  }

  try {
    const { list } = await executor.collect({ env: stage.env });
    return { list, close };
  } catch (error) {
    // A rejected collect must still close an in-flight browser launch.
    await executor.close().catch(() => undefined);
    throw error;
  }
};

/**
 * The `--filesOnly` listing: a pure read of the resolved plan. Iterates the
 * plan's full project list (not the runnable subsets) in the resolver's order;
 * projects the plan resolved out have no entries and contribute nothing.
 */
const collectTestFiles = (planner: TestPlanner) => {
  const { projects, entriesCache } = planner.getPlan();
  const list: ListCommandResult[] = projects.flatMap((project) =>
    Object.values(entriesCache.get(project.environmentName)?.entries ?? {}).map(
      (testPath) => ({
        testPath,
        project: project.name,
        tests: [],
      }),
    ),
  );

  return {
    close: async () => undefined,
    errors: [],
    list,
    getSourceMap: async () => null,
  };
};

/**
 * Collect both sides of the plan concurrently.
 */
const collectAllTests = async ({
  context,
  planner,
}: {
  context: Rstest;
  planner: TestPlanner;
}): Promise<{
  errors?: FormattedError[];
  list: ListCommandResult[];
  getSourceMap: (name: string) => Promise<string | null | undefined>;
  close: () => Promise<void>;
}> => {
  const prepared = await prepareBrowserCollection({ context, planner });

  // Settle both sides before unwrapping: a fail-fast `Promise.all` would leak
  // the surviving side's resources (node rsbuild server + pool, or browser
  // provider + dev server) when the other side rejects. Close the survivor,
  // then let the re-await below rethrow the first failure in order.
  const nodePromise = collectNodeTests({ context, planner });
  const browserPromise = collectBrowserTests(prepared);
  const [nodeSettled, browserSettled] = await Promise.allSettled([
    nodePromise,
    browserPromise,
  ]);
  if (
    nodeSettled.status === 'rejected' ||
    browserSettled.status === 'rejected'
  ) {
    await Promise.all([
      nodeSettled.status === 'fulfilled' &&
        nodeSettled.value.close().catch(() => undefined),
      browserSettled.status === 'fulfilled' &&
        browserSettled.value.close().catch(() => undefined),
    ]);
  }
  const [nodeResult, browserResult] = await Promise.all([
    nodePromise,
    browserPromise,
  ]);

  return {
    errors: [...(nodeResult.errors ?? []), ...(browserResult.errors ?? [])],
    list: [...nodeResult.list, ...browserResult.list],
    getSourceMap: nodeResult.getSourceMap,
    close: async () => {
      const closePromises = [nodeResult.close(), browserResult.close()];
      await Promise.allSettled(closePromises);
      await Promise.all(closePromises);
    },
  };
};

export async function listTests(
  context: Rstest,
  { filesOnly }: ListCommandCollectOptions,
): Promise<ListCommandCollectionResult> {
  // Read before the planner resolves: environment-comment grouping may split
  // one configured project into several, which must not flip on the project
  // column.
  const showProject = context.projects.length > 1;
  const createClose = (closeCollection: () => Promise<void>) => {
    let closePromise: Promise<void> | undefined;
    return () => {
      closePromise ??= (async () => {
        await closeCollection();
        context.exitCode.finishCycle();
      })();
      return closePromise;
    };
  };

  if (context.relatedResolutionEmpty) {
    return {
      list: [],
      errors: [],
      showProject,
      getSourceMap: async () => null,
      close: createClose(async () => undefined),
    };
  }

  const browserProjects = context.projects.filter(isBrowserProject);
  const nodeProjects = context.projects.filter(isNodeProject);

  // The same init barrier the run path resolves through: node and browser
  // `modifyRstestConfig` hooks fire inside the planner (the browser's via the
  // files-only discovery boot), the runnable subsets are resolved from
  // post-hook entries with empty projects dropped, and the shard banner is
  // announced once. Nothing below reads a plan that is still moving.
  const planner = await createTestPlanner(context, {
    browserProjects,
    nodeProjects,
    isWatchMode: false,
  });

  // An invalid browser config must fail the list whether or not this list
  // loads a browser executor — the executor load inside collectBrowserTests
  // is the only other thing that would validate it, and both an empty browser
  // plan and the `--filesOnly` pure plan read bypass it. Stricter than the
  // run path, which skips the check when node tests exist (see the empty-run
  // branch in `runTests.ts` for the divergence and its e2e pin).
  if (
    browserProjects.length &&
    !planner.hasValidatedBrowserConfig() &&
    (filesOnly || !planner.hasBrowserTestsToRun())
  ) {
    await validateBrowserRunConfig(context, browserProjects);
  }

  let collected: Awaited<ReturnType<typeof collectAllTests>>;
  try {
    collected = filesOnly
      ? collectTestFiles(planner)
      : await collectAllTests({ context, planner });
  } catch (error) {
    await runGlobalTeardown(context);
    throw error;
  }
  const { list, close, getSourceMap, errors = [] } = collected;
  const closeCollection = async () => {
    try {
      await close();
    } finally {
      await runGlobalTeardown(context);
    }
  };

  const hasError = list.some((file) => file.errors?.length) || errors.length;
  if (hasError) {
    context.exitCode.raise(1);
  }

  return {
    list,
    errors,
    showProject,
    getSourceMap,
    close: createClose(closeCollection),
  };
}
