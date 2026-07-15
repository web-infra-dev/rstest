import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { normalize, relative, resolve as resolvePath } from 'pathe';
import { createPool } from '../pool';
import type {
  FormattedError,
  ListCommandOptions,
  ListCommandResult,
  Location,
  ProjectContext,
  RstestContext,
  TestInfo,
} from '../types';
import {
  bgColor,
  color,
  getTaskNameWithPrefix,
  logger,
  prettyTestPath,
  ROOT_SUITE_NAME,
} from '../utils';
import {
  claimGlobalSetupOnce,
  runGlobalSetup,
  runGlobalTeardown,
} from './globalSetup';
import { createSetupFileState } from './setupFileState';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import { createListProjectPlanState, syncNodeProjects } from './projectPlan';
import { getUserRstestConfigPluginProjects } from './modifyRstestConfig';

type ListedTest = {
  file: string;
  name?: string;
  project?: string;
  location?: Location;
  type: 'file' | 'suite' | 'case';
};

const SummaryProjectLabel = color.gray('Projects'.padStart(11));
const SummaryTestFileLabel = color.gray('Test Files'.padStart(11));
const SummarySuiteLabel = color.gray('Suites'.padStart(11));
const SummaryTestLabel = color.gray('Tests'.padStart(11));

const getListSummaryCounts = (tests: ListedTest[]) => {
  const projects = new Set<string>();
  const files = new Set<string>();
  let suites = 0;
  let testCases = 0;

  for (const test of tests) {
    if (test.project) {
      projects.add(test.project);
    }

    files.add(`${test.project ?? ''}\0${test.file}`);

    if (test.type === 'suite') {
      suites += 1;
    }

    if (test.type === 'case') {
      testCases += 1;
    }
  }

  return {
    projects: projects.size,
    files: files.size,
    suites,
    testCases,
  };
};

const printListSummary = ({
  tests,
  filesOnly,
  includeSuites,
  showProject,
  write,
}: {
  tests: ListedTest[];
  filesOnly?: boolean;
  includeSuites?: boolean;
  showProject: boolean;
  write: (message: string) => void;
}) => {
  const counts = getListSummaryCounts(tests);

  write('');

  if (showProject) {
    write(`${SummaryProjectLabel} ${color.bold(`${counts.projects} matched`)}`);
  }

  write(`${SummaryTestFileLabel} ${color.bold(`${counts.files} matched`)}`);

  if (filesOnly) {
    return;
  }

  if (includeSuites) {
    write(`${SummarySuiteLabel} ${color.bold(`${counts.suites} matched`)}`);
  }

  write(`${SummaryTestLabel} ${color.bold(`${counts.testCases} matched`)}`);
};

const createListSummaryPayload = ({
  tests,
  filesOnly,
  includeSuites,
  showProject,
}: {
  tests: ListedTest[];
  filesOnly?: boolean;
  includeSuites?: boolean;
  showProject: boolean;
}) => {
  const counts = getListSummaryCounts(tests);
  const summary: {
    files: number;
    projects?: number;
    suites?: number;
    tests?: number;
  } = {
    files: counts.files,
  };

  if (showProject) {
    summary.projects = counts.projects;
  }

  if (!filesOnly) {
    if (includeSuites) {
      summary.suites = counts.suites;
    }
    summary.tests = counts.testCases;
  }

  return summary;
};

/**
 * Collect tests from node mode projects using Rsbuild and worker pool.
 */
const collectNodeTests = async ({
  context,
  nodeProjects,
  globTestSourceEntries,
  onRsbuildConfigResolved,
  onModifyRstestConfigApplied,
}: {
  context: RstestContext;
  nodeProjects: ProjectContext[];
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  onRsbuildConfigResolved?: () => Promise<void>;
  onModifyRstestConfigApplied?: () => Promise<void>;
}) => {
  if (nodeProjects.length === 0) {
    return {
      list: [],
      getSourceMap: async () => null,
      close: async () => undefined,
    };
  }

  const setupFileState = createSetupFileState();

  const rsbuildInstance = await prepareRsbuild({
    context,
    globTestSourceEntries,
    setupFileState,
    targetProjects: nodeProjects,
    getSetupFileProjects: () => ({
      setupProjects: nodeProjects,
      globalSetupProjects: context.projects,
    }),
    onModifyRstestConfigApplied: async () => {
      await onModifyRstestConfigApplied?.();
      syncNodeProjects(nodeProjects, context.projects);
    },
    onRsbuildConfigResolved: async () => {
      await onRsbuildConfigResolved?.();
      syncNodeProjects(nodeProjects, context.projects);
    },
  });

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

  const pool = await createPool({
    context,
  });

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
      } = await getRsbuildStats({ environmentName: project.environmentName });

      if (
        claimGlobalSetupOnce(project, entries.length, globalSetupEntries.length)
      ) {
        const files = globalSetupEntries.flatMap((e) => e.files!);
        const assetFilesPromise = getAssetFiles(files);
        const sourceMapsPromise = getSourceMaps(files);
        const [assetFiles, sourceMaps] = await Promise.all([
          assetFilesPromise,
          sourceMapsPromise,
        ]);

        const { success, errors } = await runGlobalSetup({
          globalSetupEntries,
          assetFiles,
          sourceMaps,
          interopDefault: true,
          outputModule: project.outputModule,
          runtimeTsTransform: project.normalizedConfig.runtimeTsTransform,
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

      const list = await pool.collectTests({
        entries,
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
      await runGlobalTeardown();
      await closeServer();
      await pool.close();
    },
  };
};

/**
 * Collect tests from browser mode projects using headless browser.
 */
const collectBrowserTests = async ({
  context,
  browserProjects,
  shardedEntries,
  freezeShardedEntries,
  filesOnly,
  appliedModifyRstestConfigEnvironments,
}: {
  context: RstestContext;
  browserProjects: ProjectContext[];
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
  freezeShardedEntries?: boolean;
  filesOnly?: boolean;
  appliedModifyRstestConfigEnvironments?: Set<string>;
}): Promise<{
  list: ListCommandResult[];
  close: () => Promise<void>;
}> => {
  if (browserProjects.length === 0) {
    return {
      list: [],
      close: async () => undefined,
    };
  }

  // Collect through the executor seam so `rstest list` and the run path share
  // one browser entry point (import stays dynamic: no browser module load for
  // node-only lists).
  const { loadBrowserExecutor } = await import('./browserLoader');
  const executor = await loadBrowserExecutor(context, browserProjects, null, {
    freezeShardedEntries,
    filesOnly,
    appliedModifyRstestConfigEnvironments,
  });
  const { list } = await executor.collect({ shardedEntries });
  return { list, close: () => executor.close() };
};

const collectTestFiles = async ({
  context,
  globTestSourceEntries,
}: {
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
}) => {
  const projectLists: ListCommandResult[][] = await Promise.all(
    context.projects.map(async (project) => {
      const files = await globTestSourceEntries(project.environmentName);
      return Object.values(files).map((testPath) => ({
        testPath,
        project: project.name,
        tests: [],
      }));
    }),
  );

  const list = projectLists.flat();

  return {
    close: async () => undefined,
    errors: [],
    list,
    getSourceMap: async () => null,
  };
};

/**
 * Collect all tests by separating browser and node mode projects.
 */
const collectAllTests = async ({
  context,
  globTestSourceEntries,
  getShardedEntries,
  collectBrowserAfterConfigHooks,
  onModifyRstestConfigApplied,
  onRsbuildConfigResolved,
  appliedModifyRstestConfigEnvironments,
}: {
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  getShardedEntries?: () =>
    Map<string, { entries: Record<string, string> }> | undefined;
  collectBrowserAfterConfigHooks?: boolean;
  onModifyRstestConfigApplied?: () => Promise<void>;
  onRsbuildConfigResolved?: () => Promise<void>;
  appliedModifyRstestConfigEnvironments?: Set<string>;
}): Promise<{
  errors?: FormattedError[];
  list: ListCommandResult[];
  getSourceMap: (name: string) => Promise<string | null | undefined>;
  close: () => Promise<void>;
}> => {
  // Separate browser and node mode projects
  const browserProjects = context.projects.filter(isBrowserProject);
  const nodeProjects = context.projects.filter(isNodeProject);

  const collectBrowser = () =>
    collectBrowserTests({
      context,
      browserProjects,
      shardedEntries: getShardedEntries?.(),
      freezeShardedEntries: Boolean(
        context.normalizedConfig.shard && nodeProjects.length,
      ),
      appliedModifyRstestConfigEnvironments,
    });

  if (collectBrowserAfterConfigHooks && nodeProjects.length) {
    let refreshedAfterConfigHooks = false;
    const nodeResult = await collectNodeTests({
      context,
      nodeProjects,
      globTestSourceEntries,
      onRsbuildConfigResolved,
      onModifyRstestConfigApplied: async () => {
        refreshedAfterConfigHooks = true;
        await onModifyRstestConfigApplied?.();
      },
    });
    if (
      !refreshedAfterConfigHooks &&
      !context.projects.some((project) => project._environmentGroup)
    ) {
      await onModifyRstestConfigApplied?.();
    }
    let browserResult: Awaited<ReturnType<typeof collectBrowser>>;
    try {
      browserResult = await collectBrowser();
    } catch (error) {
      await nodeResult.close();
      throw error;
    }

    return {
      errors: nodeResult.errors,
      list: [...nodeResult.list, ...browserResult.list],
      getSourceMap: nodeResult.getSourceMap,
      close: async () => {
        await Promise.all([nodeResult.close(), browserResult.close()]);
      },
    };
  }

  const [nodeResult, browserResult] = await Promise.all([
    collectNodeTests({
      context,
      nodeProjects,
      globTestSourceEntries,
      onRsbuildConfigResolved,
      onModifyRstestConfigApplied,
    }),
    collectBrowser(),
  ]);

  return {
    errors: nodeResult.errors,
    list: [...nodeResult.list, ...browserResult.list],
    getSourceMap: nodeResult.getSourceMap,
    close: async () => {
      await Promise.all([nodeResult.close(), browserResult.close()]);
    },
  };
};

export async function listTests(
  context: RstestContext,
  {
    filesOnly,
    json,
    printLocation,
    includeSuites,
    summary,
  }: ListCommandOptions,
): Promise<ListCommandResult[]> {
  const { rootPath } = context;
  const { shard } = context.normalizedConfig;
  const showProject = context.projects.length > 1;

  const isFilterInsideProject = (filter: string, project: ProjectContext) => {
    const absoluteFilter = normalize(
      isAbsolute(filter) ? filter : resolvePath(rootPath, filter),
    );
    const relativeFilter = normalize(
      relative(project.rootPath, absoluteFilter),
    );

    return (
      relativeFilter === '' ||
      (!relativeFilter.startsWith('..') && !isAbsolute(relativeFilter))
    );
  };

  const isFuzzyBasenameFilter = (filter: string) => {
    if (context.fileFilterMode === 'exact' || isAbsolute(filter)) {
      return false;
    }

    const normalizedFilter = normalize(filter);
    return (
      !normalizedFilter.startsWith('.') &&
      !normalizedFilter.includes('/') &&
      !normalizedFilter.includes('\\')
    );
  };

  if (context.relatedResolutionEmpty) {
    const tests: ListedTest[] = [];

    if (json && json !== 'false') {
      const content = JSON.stringify(
        summary
          ? {
              items: tests,
              summary: createListSummaryPayload({
                tests,
                filesOnly,
                includeSuites,
                showProject,
              }),
            }
          : tests,
        null,
        2,
      );
      if (json !== true && json !== 'true') {
        const jsonPath = isAbsolute(json) ? json : join(rootPath, json);
        mkdirSync(dirname(jsonPath), { recursive: true });
        writeFileSync(jsonPath, content);
      } else {
        logger.log(content);
      }
    } else if (summary) {
      printListSummary({
        tests,
        filesOnly,
        includeSuites,
        showProject,
        write: logger.log,
      });
    }

    return [];
  }

  const listPlanState = createListProjectPlanState(context);
  const appliedBrowserModifyRstestConfigEnvironments = new Set<string>();
  const {
    globTestSourceEntries,
    refreshListEntries,
    validateEnvironmentComments,
  } = listPlanState;

  const nodeProjects = context.projects.filter(isNodeProject);
  const shouldPrintShardAfterConfigHooks = Boolean(
    shard && !filesOnly && nodeProjects.length,
  );

  const applyBrowserFilesOnlyConfigHooks = async () => {
    const browserProjects = context.projects.filter(isBrowserProject);

    if (!browserProjects.length) {
      return;
    }

    const browserConfigHookProjects =
      getUserRstestConfigPluginProjects(browserProjects);
    if (!browserConfigHookProjects.length) {
      return;
    }

    let projectsToInitialize = browserConfigHookProjects;
    if (
      context.fileFilters?.length &&
      !context.fileFilters.some(isFuzzyBasenameFilter)
    ) {
      const matchedProjects = browserConfigHookProjects.filter((project) =>
        context.fileFilters?.some((filter) =>
          isFilterInsideProject(filter, project),
        ),
      );
      if (matchedProjects.length > 0) {
        projectsToInitialize = matchedProjects;
      } else if (
        context.fileFilters.every((filter) =>
          [...browserProjects, ...nodeProjects].some((project) =>
            isFilterInsideProject(filter, project),
          ),
        )
      ) {
        return;
      }
    }

    const browserResult = await collectBrowserTests({
      context,
      browserProjects: projectsToInitialize,
      shardedEntries: shard
        ? listPlanState.getShardedBrowserEntries?.()
        : undefined,
      filesOnly: true,
      appliedModifyRstestConfigEnvironments:
        appliedBrowserModifyRstestConfigEnvironments,
    });
    await browserResult.close();
    await refreshListEntries({
      silentShardMessage: true,
      strictEnvironmentComments: true,
    });
  };

  if (nodeProjects.length && filesOnly) {
    await refreshListEntries({
      silentShardMessage: Boolean(shard),
      strictEnvironmentComments: false,
    });
    syncNodeProjects(nodeProjects, context.projects);
    let refreshedAfterConfigHooks = false;

    const rsbuildInstance = await prepareRsbuild({
      context,
      globTestSourceEntries,
      setupFileState: createSetupFileState(),
      targetProjects: nodeProjects,
      onModifyRstestConfigApplied: async () => {
        refreshedAfterConfigHooks = true;
        await refreshListEntries({
          silentShardMessage: !shard,
          strictEnvironmentComments: false,
        });
        syncNodeProjects(nodeProjects, context.projects);
      },
      onRsbuildConfigResolved: validateEnvironmentComments,
    });
    await rsbuildInstance.initConfigs({ action: 'dev' });
    if (!refreshedAfterConfigHooks) {
      await refreshListEntries({
        silentShardMessage: !shard,
        strictEnvironmentComments: true,
      });
      syncNodeProjects(nodeProjects, context.projects);
    }

    await applyBrowserFilesOnlyConfigHooks();
  } else if (filesOnly) {
    await refreshListEntries({
      silentShardMessage: Boolean(shard),
      strictEnvironmentComments: !nodeProjects.length,
    });

    await applyBrowserFilesOnlyConfigHooks();
  } else {
    await refreshListEntries({
      silentShardMessage: shouldPrintShardAfterConfigHooks,
      strictEnvironmentComments: !nodeProjects.length,
    });
    if (shouldPrintShardAfterConfigHooks) {
      await applyBrowserFilesOnlyConfigHooks();
    }
  }

  const {
    list,
    close,
    getSourceMap,
    errors = [],
  } = filesOnly
    ? await collectTestFiles({
        context,
        globTestSourceEntries,
      })
    : await collectAllTests({
        context,
        globTestSourceEntries,
        getShardedEntries: shard
          ? listPlanState.getShardedBrowserEntries
          : undefined,
        collectBrowserAfterConfigHooks: shouldPrintShardAfterConfigHooks,
        onRsbuildConfigResolved: validateEnvironmentComments,
        onModifyRstestConfigApplied: () =>
          refreshListEntries({
            silentShardMessage: !shouldPrintShardAfterConfigHooks,
            strictEnvironmentComments: false,
          }),
        appliedModifyRstestConfigEnvironments:
          appliedBrowserModifyRstestConfigEnvironments,
      });

  const tests: ListedTest[] = [];

  const traverseTests = (test: TestInfo) => {
    if (['skip', 'todo'].includes(test.runMode)) {
      return;
    }

    if (
      test.type === 'case' ||
      (includeSuites && test.type === 'suite' && test.name !== ROOT_SUITE_NAME)
    )
      tests.push({
        file: test.testPath,
        name: getTaskNameWithPrefix(test),
        location: test.location,
        type: test.type,
        project: showProject ? test.project : undefined,
      });

    if (test.type === 'suite') {
      for (const child of test.tests) {
        traverseTests(child);
      }
    }
  };

  const hasError = list.some((file) => file.errors?.length) || errors.length;
  if (hasError) {
    const { printError } = await import('../utils/error');
    process.exitCode = 1;
    for (const file of list) {
      const relativePath = relative(rootPath, file.testPath);

      if (file.errors?.length) {
        //  FAIL  tests/index.test.ts
        logger.log(`${bgColor('bgRed', ' FAIL ')} ${relativePath}`);

        for (const error of file.errors) {
          await printError(
            error,
            async (name) => {
              const sourceMap = await getSourceMap(name);
              return sourceMap ? JSON.parse(sourceMap) : null;
            },
            rootPath,
          );
        }
      }
    }

    if (errors.length) {
      const { printError } = await import('../utils/error');
      for (const error of errors || []) {
        logger.stderr(bgColor('bgRed', ' Unhandled Error '));
        await printError(
          error,
          async (name) => {
            const sourceMap = await getSourceMap(name);
            return sourceMap ? JSON.parse(sourceMap) : null;
          },
          rootPath,
        );
      }
    }

    await close();
    return list;
  }

  for (const file of list) {
    if (filesOnly) {
      if (showProject) {
        tests.push({
          file: file.testPath,
          project: file.project,
          type: 'file',
        });
      } else {
        tests.push({
          file: file.testPath,
          type: 'file',
        });
      }
      continue;
    }
    for (const test of file.tests) {
      traverseTests(test);
    }
  }

  if (json && json !== 'false') {
    const content = JSON.stringify(
      summary
        ? {
            items: tests,
            summary: createListSummaryPayload({
              tests,
              filesOnly,
              includeSuites,
              showProject,
            }),
          }
        : tests,
      null,
      2,
    );
    if (json !== true && json !== 'true') {
      const jsonPath = isAbsolute(json) ? json : join(rootPath, json);
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, content);
    } else {
      logger.log(content);
    }
  } else {
    for (const test of tests) {
      let shortPath = relative(rootPath, test.file);
      if (test.location && printLocation) {
        shortPath = `${shortPath}:${test.location.line}:${test.location.column}`;
      }
      logger.log(
        test.name
          ? `${color.dim(`${shortPath} > `)}${test.name}`
          : prettyTestPath(shortPath),
      );
    }

    if (summary) {
      printListSummary({
        tests,
        filesOnly,
        includeSuites,
        showProject,
        write: logger.log,
      });
    }
  }

  await close();

  return list;
}
