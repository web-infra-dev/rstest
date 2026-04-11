import { constants as osConstants } from 'node:os';
import { createCoverageProvider } from '../coverage';
import { createPool } from '../pool';
import type {
  EntryInfo,
  ProjectContext,
  ProjectEntries,
  SourceMapInput,
  TestFileCoverageResult,
  TestRunEndReason,
  TestRunKind,
} from '../types';
import {
  clearScreen,
  color,
  getTestEntries,
  logger,
  resolveShardedEntries,
} from '../utils';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  loadBrowserModule,
} from './browserLoader';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { runGlobalSetup, runGlobalTeardown } from './globalSetup';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';
import type { Rstest } from './rstest';

type Mode = 'all' | 'on-demand';
type RunOptions = {
  fileFilters?: string[];
  mode?: Mode;
  buildStart?: number;
};

type RsbuildServer = Awaited<ReturnType<typeof createRsbuildServer>>;
type RsbuildStats = Awaited<ReturnType<RsbuildServer['getRsbuildStats']>>;
type PoolController = Awaited<ReturnType<typeof createPool>>;
type PoolRunResult = Awaited<ReturnType<PoolController['runTests']>>;

type PreparedRun = Pick<
  RsbuildStats,
  'assetNames' | 'getAssetFiles' | 'getSourceMaps' | 'setupEntries'
> & {
  errors: Error[];
  finalEntries: EntryInfo[];
  project: ProjectContext;
};

type RunResult = Pick<
  PoolRunResult,
  'coverageResults' | 'results' | 'testResults'
> &
  Pick<PreparedRun, 'assetNames' | 'getSourceMaps'> & {
    errors: Error[];
  };

type ProjectSelection = {
  browserProjectsToRun: ProjectContext[];
  nodeProjectsToRun: ProjectContext[];
};

type PreparedProjectRun = {
  currentEntries: EntryInfo[];
  deletedEntries: string[];
  preparedRun: PreparedRun;
  testStart: number;
};

type RunArtifacts = {
  browserClose?: NonNullable<BrowserTestRunResult['close']>;
  coverageResults: TestFileCoverageResult[];
  duration: BrowserTestRunResult['duration'];
  errors: Error[];
  getSourcemap: (sourcePath: string) => Promise<SourceMapInput | null>;
  hasFailure: boolean;
  results: RunResult['results'];
  testResults: RunResult['testResults'];
};

type RunFn = (options?: RunOptions) => Promise<void>;
type WatchShortcutActions = Parameters<typeof setupCliShortcuts>[0];

/**
 * Run browser mode tests.
 * Returns the result for unified reporter output.
 */
async function runBrowserModeTests(
  context: Rstest,
  browserProjects: typeof context.projects,
  options: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const { validateBrowserConfig, runBrowserTests } = await loadBrowserModule({
    projectRoots,
  });
  validateBrowserConfig(context);
  return runBrowserTests(context, options);
}

const getSignalExitCode = (signal: NodeJS.Signals): number => {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
};

const hasProjectEntries = (
  entriesCache: Map<string, ProjectEntries>,
  environmentName: string,
): boolean =>
  Object.keys(entriesCache.get(environmentName)?.entries || {}).length > 0;

const emptySourceMaps = async (): Promise<Record<string, string>> => ({});

const resolveFinalEntries = ({
  affectedEntries,
  entries,
  fileFilters,
  mode,
  project,
}: {
  affectedEntries: EntryInfo[];
  entries: EntryInfo[];
  fileFilters?: string[];
  mode: Mode;
  project: ProjectContext;
}): EntryInfo[] => {
  if (mode === 'on-demand') {
    if (affectedEntries.length === 0) {
      logger.debug(
        color.yellow(
          `No test files need re-run in project(${project.environmentName}).`,
        ),
      );
    } else {
      logger.debug(
        color.yellow(
          `Test files to re-run in project(${project.environmentName}):\n`,
        ) +
          affectedEntries.map((entry) => entry.testPath).join('\n') +
          '\n',
      );
    }
    return affectedEntries;
  }

  logger.debug(
    color.yellow(
      fileFilters?.length
        ? `Run filtered tests in project(${project.environmentName}).\n`
        : `Run all tests in project(${project.environmentName}).\n`,
    ),
  );
  return entries;
};

const prepareProjectRun = async ({
  fileFilters,
  getRsbuildStats,
  mode,
  project,
}: {
  fileFilters?: string[];
  getRsbuildStats: RsbuildServer['getRsbuildStats'];
  mode: Mode;
  project: ProjectContext;
}): Promise<PreparedProjectRun> => {
  const {
    assetNames,
    entries,
    setupEntries,
    globalSetupEntries,
    getAssetFiles,
    getSourceMaps,
    affectedEntries,
    deletedEntries,
  } = await getRsbuildStats({
    environmentName: project.environmentName,
    fileFilters,
  });

  const testStart = Date.now();

  if (entries.length && globalSetupEntries.length && !project._globalSetups) {
    project._globalSetups = true;
    const files = globalSetupEntries.flatMap((entry) => entry.files!);
    const [assetFiles, sourceMaps] = await Promise.all([
      getAssetFiles(files),
      getSourceMaps(files),
    ]);

    const { success, errors } = await runGlobalSetup({
      globalSetupEntries,
      assetFiles,
      sourceMaps,
      interopDefault: true,
      outputModule: project.outputModule,
    });

    if (!success) {
      return {
        currentEntries: [],
        deletedEntries: [],
        preparedRun: {
          errors: errors ?? [],
          assetNames,
          finalEntries: [],
          getAssetFiles,
          getSourceMaps: emptySourceMaps,
          project,
          setupEntries,
        },
        testStart,
      };
    }
  }

  const finalEntries = resolveFinalEntries({
    affectedEntries,
    entries,
    fileFilters,
    mode,
    project,
  });

  return {
    currentEntries: finalEntries,
    deletedEntries,
    preparedRun: {
      assetNames,
      errors: [],
      finalEntries,
      getAssetFiles,
      getSourceMaps,
      project,
      setupEntries,
    },
    testStart,
  };
};

const executePreparedRun = async ({
  preparedRun,
  pool,
  snapshotManager,
}: {
  pool: PoolController;
  preparedRun: PreparedRun;
  snapshotManager: Rstest['snapshotManager'];
}): Promise<RunResult> => {
  if (preparedRun.errors.length > 0) {
    return {
      coverageResults: [],
      results: [],
      testResults: [],
      errors: preparedRun.errors,
      assetNames: preparedRun.assetNames,
      getSourceMaps: preparedRun.getSourceMaps,
    };
  }

  const { coverageResults, results, testResults } = await pool.runTests({
    entries: preparedRun.finalEntries,
    getSourceMaps: preparedRun.getSourceMaps,
    setupEntries: preparedRun.setupEntries,
    getAssetFiles: preparedRun.getAssetFiles,
    project: preparedRun.project,
    updateSnapshot: snapshotManager.options.updateSnapshot,
  });

  return {
    coverageResults,
    results,
    testResults,
    errors: [],
    assetNames: preparedRun.assetNames,
    getSourceMaps: preparedRun.getSourceMaps,
  };
};

const selectProjectsToRun = async ({
  allProjects,
  browserProjects,
  nodeProjects,
  entriesCache,
  globTestSourceEntries,
  isWatchMode,
  shard,
}: {
  allProjects: ProjectContext[];
  browserProjects: ProjectContext[];
  nodeProjects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  isWatchMode: boolean;
  shard: Rstest['normalizedConfig']['shard'];
}): Promise<ProjectSelection> => {
  if (!isWatchMode) {
    await Promise.all(
      allProjects.map((project) =>
        globTestSourceEntries(project.environmentName),
      ),
    );

    return {
      browserProjectsToRun: browserProjects.filter((project) =>
        hasProjectEntries(entriesCache, project.environmentName),
      ),
      nodeProjectsToRun: nodeProjects.filter((project) =>
        hasProjectEntries(entriesCache, project.environmentName),
      ),
    };
  }

  if (!shard) {
    return {
      browserProjectsToRun: browserProjects,
      nodeProjectsToRun: nodeProjects,
    };
  }

  return {
    browserProjectsToRun: browserProjects.filter((project) =>
      hasProjectEntries(entriesCache, project.environmentName),
    ),
    nodeProjectsToRun: nodeProjects.filter((project) =>
      hasProjectEntries(entriesCache, project.environmentName),
    ),
  };
};

const createBrowserRunOptions = ({
  browserProjectsToRun,
  entriesCache,
  shard,
  shouldUnifyReporter,
}: {
  browserProjectsToRun: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  shard: Rstest['normalizedConfig']['shard'];
  shouldUnifyReporter: boolean;
}): BrowserTestRunOptions => {
  if (!shard) {
    return { skipOnTestRunEnd: shouldUnifyReporter };
  }

  const shardedEntries = new Map<string, { entries: Record<string, string> }>();
  for (const project of browserProjectsToRun) {
    const cachedEntries = entriesCache.get(project.environmentName);
    if (cachedEntries) {
      shardedEntries.set(project.environmentName, {
        entries: cachedEntries.entries,
      });
    }
  }

  return {
    skipOnTestRunEnd: shouldUnifyReporter,
    shardedEntries,
  };
};

const collectCurrentTestPaths = ({
  browserProjectsToRun,
  currentEntries,
  entriesCache,
  shouldUnifyReporter,
}: {
  browserProjectsToRun: ProjectContext[];
  currentEntries: EntryInfo[];
  entriesCache: Map<string, ProjectEntries>;
  shouldUnifyReporter: boolean;
}): string[] => {
  const browserCurrentTestPaths = shouldUnifyReporter
    ? browserProjectsToRun.flatMap((project) =>
        Object.values(entriesCache.get(project.environmentName)?.entries || {}),
      )
    : [];

  return Array.from(
    new Set([
      ...currentEntries.map((entry) => entry.testPath),
      ...browserCurrentTestPaths,
    ]),
  );
};

const isNoTestsRun = ({
  errors,
  results,
}: {
  errors: Error[];
  results: RunResult['results'];
}): boolean => results.length === 0 && errors.length === 0;

const getRunReason = ({
  errors,
  hasFailure,
  results,
}: {
  errors: Error[];
  hasFailure: boolean;
  results: RunResult['results'];
}): TestRunEndReason => {
  if (isNoTestsRun({ results, errors })) {
    return 'no-tests';
  }
  return hasFailure ? 'failed' : 'passed';
};

const handleEmptyRun = ({
  allProjects,
  command,
  context,
  mode,
}: {
  allProjects: ProjectContext[];
  command: Rstest['command'];
  context: Rstest;
  mode: Mode;
}): boolean => {
  if (command === 'watch') {
    logger.log(
      color.yellow(
        mode === 'on-demand'
          ? 'No test files need re-run.'
          : 'No test files found.',
      ),
    );
  } else {
    const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
    const message = `No test files found, exiting with code ${code}.`;

    if (code === 0) {
      logger.log(color.yellow(message));
    } else {
      logger.error(color.red(message));
    }

    process.exitCode = code;
  }

  if (mode === 'all') {
    if (context.fileFilters?.length) {
      logger.log(
        color.gray('filter: '),
        context.fileFilters.join(color.gray(', ')),
      );
    }

    allProjects.forEach((project) => {
      if (allProjects.length > 1) {
        logger.log('');
        logger.log(color.gray('project:'), project.name);
      }
      logger.log(color.gray('root:'), project.rootPath);
      logger.log(
        color.gray('include:'),
        project.normalizedConfig.include.join(color.gray(', ')),
      );
      logger.log(
        color.gray('exclude:'),
        project.normalizedConfig.exclude.patterns.join(color.gray(', ')),
      );
    });
  }

  return command === 'watch' && mode === 'on-demand';
};

const resolveRunArtifacts = async ({
  browserResultPromise,
  buildTime,
  returns,
  shouldUnifyReporter,
  testTime,
}: {
  browserResultPromise?: Promise<BrowserTestRunResult | void>;
  buildTime: number;
  returns: RunResult[];
  shouldUnifyReporter: boolean;
  testTime: number;
}): Promise<RunArtifacts> => {
  const browserResult = browserResultPromise
    ? await browserResultPromise
    : undefined;
  const browserResolveSourcemap = browserResult?.resolveSourcemap;

  const nodeResourceByAssetName = new Map<string, RunResult['getSourceMaps']>();
  for (const item of returns) {
    for (const assetName of item.assetNames) {
      nodeResourceByAssetName.set(assetName, item.getSourceMaps);
    }
  }

  const getSourcemap = async (
    sourcePath: string,
  ): Promise<SourceMapInput | null> => {
    if (browserResolveSourcemap) {
      const resolved = await browserResolveSourcemap(sourcePath);
      if (resolved.handled) {
        return resolved.sourcemap;
      }
    }

    const getSourceMaps = nodeResourceByAssetName.get(sourcePath);
    const sourceMap = (await getSourceMaps?.([sourcePath]))?.[sourcePath];
    return sourceMap ? JSON.parse(sourceMap) : null;
  };

  const duration =
    shouldUnifyReporter && browserResult
      ? {
          totalTime: testTime + buildTime + browserResult.duration.totalTime,
          buildTime: buildTime + browserResult.duration.buildTime,
          testTime: testTime + browserResult.duration.testTime,
        }
      : {
          totalTime: testTime + buildTime,
          buildTime,
          testTime,
        };

  const results = returns.flatMap((result) => result.results);
  const coverageResults = returns.flatMap((result) => result.coverageResults);
  const testResults = returns.flatMap((result) => result.testResults);
  const errors = returns.flatMap((result) => result.errors);

  if (shouldUnifyReporter && browserResult?.results) {
    results.push(...browserResult.results);
    for (const result of browserResult.results) {
      if (result.coverage) {
        coverageResults.push({
          testPath: result.testPath,
          project: result.project,
          coverage: result.coverage,
        });
        delete result.coverage;
      }
    }
  }

  if (shouldUnifyReporter && browserResult?.testResults) {
    testResults.push(...browserResult.testResults);
  }

  if (shouldUnifyReporter && browserResult?.unhandledErrors) {
    errors.push(...browserResult.unhandledErrors);
  }

  return {
    browserClose: browserResult?.close,
    coverageResults,
    duration,
    errors,
    getSourcemap,
    hasFailure:
      results.some((result) => result.status === 'fail') ||
      errors.length > 0 ||
      Boolean(shouldUnifyReporter && browserResult?.hasFailure),
    results,
    testResults,
  };
};

const collectRunnableTestEntries = async ({
  globTestSourceEntries,
  projects,
}: {
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  projects: ProjectContext[];
}): Promise<string[]> => {
  const entries = await Promise.all(
    projects.map((project) => globTestSourceEntries(project.environmentName)),
  );

  return entries.reduce<string[]>(
    (acc, entry) => acc.concat(...Object.values(entry)),
    [],
  );
};

const createWatchShortcutActions = ({
  afterTestsWatchRun,
  closeServer,
  context,
  globTestSourceEntries,
  pool,
  projects,
  run,
  snapshotManager,
}: {
  afterTestsWatchRun: () => void;
  closeServer: () => Promise<void>;
  context: Rstest;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  pool: PoolController;
  projects: ProjectContext[];
  run: RunFn;
  snapshotManager: Rstest['snapshotManager'];
}): WatchShortcutActions => ({
  closeServer: async () => {
    await pool.close();
    await closeServer();
  },
  runAll: async () => {
    clearScreen();
    snapshotManager.clear();
    context.normalizedConfig.testNamePattern = undefined;
    context.fileFilters = undefined;

    await run({ mode: 'all' });
    afterTestsWatchRun();
  },
  runWithTestNamePattern: async (pattern?: string) => {
    clearScreen();
    context.normalizedConfig.testNamePattern = pattern;

    if (pattern) {
      logger.log(
        `\n${color.dim('Applied testNamePattern:')} ${color.bold(pattern)}\n`,
      );
    } else {
      logger.log(`\n${color.dim('Cleared testNamePattern filter')}\n`);
    }

    snapshotManager.clear();
    await run();
    afterTestsWatchRun();
  },
  runWithFileFilters: async (filters?: string[]) => {
    clearScreen();
    if (filters && filters.length > 0) {
      logger.log(
        `\n${color.dim('Applied file filters:')} ${color.bold(filters.join(', '))}\n`,
      );
    } else {
      logger.log(`\n${color.dim('Cleared file filters')}\n`);
    }

    snapshotManager.clear();
    context.fileFilters = filters;

    const entries = await collectRunnableTestEntries({
      globTestSourceEntries,
      projects,
    });

    if (!entries.length) {
      logger.log(
        filters
          ? color.yellow(
              `\nNo matching test files to run with current file filters: ${filters.join(',')}\n`,
            )
          : color.yellow('\nNo matching test files to run.\n'),
      );
      return;
    }

    await run({ fileFilters: entries });
    afterTestsWatchRun();
  },
  runFailedTests: async () => {
    const failedTests = context.reporterResults.results
      .filter((result) => result.status === 'fail')
      .map((result) => result.testPath);

    if (!failedTests.length) {
      logger.log(
        color.yellow('\nNo failed tests were found that needed to be rerun.'),
      );
      return;
    }

    clearScreen();
    snapshotManager.clear();
    await run({ fileFilters: failedTests, mode: 'all' });
    afterTestsWatchRun();
  },
  updateSnapshot: async () => {
    if (!snapshotManager.summary.unmatched) {
      logger.log(
        color.yellow('\nNo snapshots were found that needed to be updated.'),
      );
      return;
    }

    const failedTests = context.reporterResults.results
      .filter((result) => result.snapshotResult?.unmatched)
      .map((result) => result.testPath);

    clearScreen();

    const originalUpdateSnapshot = snapshotManager.options.updateSnapshot;
    snapshotManager.clear();
    snapshotManager.options.updateSnapshot = 'all';
    await run({ fileFilters: failedTests });
    afterTestsWatchRun();
    snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
  },
});

export async function runTests(context: Rstest): Promise<void> {
  // Separate browser mode and node mode projects
  const browserProjects = context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
  const nodeProjects = context.projects.filter(
    (project) => !project.normalizedConfig.browser.enabled,
  );

  const hasBrowserProjects = browserProjects.length > 0;
  const hasNodeProjects = nodeProjects.length > 0;

  const isWatchMode = context.command === 'watch';

  // For non-watch mode with both browser and node tests, we need to unify reporter output
  const shouldUnifyReporter =
    !isWatchMode && hasBrowserProjects && hasNodeProjects;

  // If only browser tests, run them and generate coverage
  if (hasBrowserProjects && !hasNodeProjects) {
    const { coverage } = context.normalizedConfig;

    if (coverage.enabled) {
      logger.log(
        ` ${color.gray('Coverage enabled with')} %s\n`,
        color.yellow(coverage.provider),
      );
    }

    const browserResult = await runBrowserModeTests(context, browserProjects, {
      skipOnTestRunEnd: false,
    });

    // Generate coverage reports for browser-only tests when execution produced test results.
    // Skip coverage on early startup failures surfaced via unhandledErrors.
    if (
      coverage.enabled &&
      browserResult?.results.length &&
      !browserResult.unhandledErrors?.length
    ) {
      const coverageProvider = await createCoverageProvider(
        coverage,
        context.rootPath,
      );
      if (coverageProvider) {
        const { generateCoverage } = await import('../coverage/generate');
        await generateCoverage(
          context,
          browserResult.results,
          coverageProvider,
        );
      }
    }

    return;
  }

  // If only node tests, run them (handled below)
  // If both, run them in parallel

  let browserResultPromise: Promise<BrowserTestRunResult | void> | undefined;

  const allProjects = context.projects;

  const { rootPath, reporters, snapshotManager, command, normalizedConfig } =
    context;
  const { coverage, shard } = normalizedConfig;

  const entriesCache: Map<string, ProjectEntries> =
    (await resolveShardedEntries(context)) || new Map();

  // Define globTestSourceEntries after entriesCache is potentially populated
  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (!isWatchMode && shard && entriesCache.has(name)) {
      return entriesCache.get(name)!.entries;
    }
    const { include, exclude, includeSource, root } = allProjects.find(
      (p) => p.environmentName === name,
    )!.normalizedConfig;
    const entries = await getTestEntries({
      include,
      exclude: exclude.patterns,
      includeSource,
      rootPath,
      projectRoot: root,
      fileFilters: context.fileFilters || [],
    });

    entriesCache.set(name, {
      entries,
      fileFilters: context.fileFilters,
    });

    return entries;
  };

  const { browserProjectsToRun, nodeProjectsToRun } = await selectProjectsToRun(
    {
      allProjects,
      browserProjects,
      nodeProjects,
      entriesCache,
      globTestSourceEntries,
      isWatchMode,
      shard,
    },
  );

  const hasBrowserTestsToRun = browserProjectsToRun.length > 0;
  const hasNodeTestsToRun = nodeProjectsToRun.length > 0;

  // If there are browser tests to run, start them.
  if (hasBrowserTestsToRun) {
    browserResultPromise = runBrowserModeTests(
      context,
      browserProjectsToRun,
      createBrowserRunOptions({
        browserProjectsToRun,
        entriesCache,
        shard,
        shouldUnifyReporter,
      }),
    );

    // Prevent an unhandled rejection window in mixed node+browser runs.
    // We still await the original promise later to surface the error.
    browserResultPromise.catch(() => undefined);
  }

  // If there are no node tests to run, we can potentially exit early.
  if (!hasNodeTestsToRun) {
    if (browserResultPromise) {
      await browserResultPromise;
    }
    // If only browser tests were to run and they ran, we should return.
    if (hasBrowserTestsToRun) {
      return;
    }
    // If no node projects at all, and no browser tests to run,
    // then nothing to do here. This handles the original early exit for no node projects.
    if (!hasNodeProjects) {
      return;
    }
  }

  // The `projects` variable now refers to node projects that have tests to run.
  const projects = nodeProjectsToRun;

  const { getSetupFiles } = await import('../utils/getSetupFiles');

  const setupFiles = Object.fromEntries(
    projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [environmentName, getSetupFiles(setupFiles, rootPath)];
    }),
  );

  const globalSetupFiles = Object.fromEntries(
    // Global setup still applies to all original projects in context
    context.projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { globalSetup },
      } = project;

      return [environmentName, getSetupFiles(globalSetup, rootPath)];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
    projects,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    inspectedConfig: {
      ...context.normalizedConfig,
      // Pass only the relevant node projects for Rsbuild processing
      projects: projects.map((p) => p.normalizedConfig),
    },
    isWatchMode,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
    rsbuildInstance,
    rootPath,
  });

  const entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
    (acc, entry) => acc.concat(Object.values(entry.entries) || []),
    [],
  );

  const getRecommendWorkerCount = (): number => {
    // TODO: the best way is to create workers on demand
    const nodeEntries = Array.from(entriesCache.entries()).filter(([key]) => {
      const project = projects.find((p) => p.environmentName === key);
      return project?.normalizedConfig.browser.enabled !== true;
    });

    return nodeEntries.flatMap(
      ([_key, entry]) => Object.values(entry.entries) || [],
    ).length;
  };

  const recommendWorkerCount =
    command === 'watch' ? Number.POSITIVE_INFINITY : getRecommendWorkerCount();

  const pool = await createPool({
    context,
    recommendWorkerCount,
  });

  // Initialize coverage collector
  const coverageProvider = coverage.enabled
    ? await createCoverageProvider(coverage, context.rootPath)
    : null;

  if (coverageProvider) {
    logger.log(
      ` ${color.gray('Coverage enabled with')} %s\n`,
      color.yellow(coverage.provider),
    );
  }

  const run: RunFn = async ({
    fileFilters,
    mode = 'all',
    buildStart = Date.now(),
  }: RunOptions = {}) => {
    let testStart: number;
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];
    const runKind: TestRunKind =
      command === 'watch' && mode === 'on-demand' ? 'rerun' : 'full';

    context.stateManager.reset();

    // TODO: this is not the best practice for collecting test files
    context.stateManager.testFiles = isWatchMode ? undefined : entryFiles;

    const preparedProjectRuns = await Promise.all(
      projects.map((project) =>
        prepareProjectRun({
          fileFilters,
          getRsbuildStats,
          mode,
          project,
        }),
      ),
    );
    testStart = Math.min(...preparedProjectRuns.map((item) => item.testStart));

    for (const item of preparedProjectRuns) {
      currentDeletedEntries.push(...item.deletedEntries);
      currentEntries.push(...item.currentEntries);
    }
    const preparedRuns = preparedProjectRuns.map((item) => item.preparedRun);

    const currentTestPaths = collectCurrentTestPaths({
      browserProjectsToRun,
      currentEntries,
      entriesCache,
      shouldUnifyReporter,
    });
    const shouldNotifyTestRunStart = !(
      command === 'watch' &&
      mode === 'on-demand' &&
      currentTestPaths.length === 0
    );

    if (shouldNotifyTestRunStart) {
      for (const reporter of reporters) {
        await reporter.onTestRunStart?.({
          testPaths: currentTestPaths,
          runKind,
        });
      }
    }

    const returns: RunResult[] = await Promise.all(
      preparedRuns.map((preparedRun) =>
        executePreparedRun({
          preparedRun,
          pool,
          snapshotManager: context.snapshotManager,
        }),
      ),
    );

    const buildTime = testStart! - buildStart;

    const testTime = Date.now() - testStart!;
    const runArtifacts = await resolveRunArtifacts({
      browserResultPromise,
      buildTime,
      returns,
      shouldUnifyReporter,
      testTime,
    });
    const {
      browserClose,
      coverageResults,
      duration,
      errors,
      getSourcemap,
      hasFailure,
      results,
      testResults,
    } = runArtifacts;

    try {
      context.updateReporterResultState(
        results,
        testResults,
        currentDeletedEntries,
      );

      if (isNoTestsRun({ results, errors })) {
        if (handleEmptyRun({ allProjects, command, context, mode })) {
          return;
        }
      }

      const reason = getRunReason({ errors, hasFailure, results });

      if (hasFailure) {
        process.exitCode = 1;
      }

      for (const reporter of reporters) {
        await reporter.onTestRunEnd?.({
          results,
          coverageResults,
          testResults,
          unhandledErrors: errors,
          snapshotSummary: snapshotManager.summary,
          duration,
          getSourcemap,
          reason,
          runKind,
        });
      }

      // Generate coverage reports after all tests complete
      if (coverageProvider && (!hasFailure || coverage.reportOnFailure)) {
        const { generateCoverage } = await import('../coverage/generate');

        await generateCoverage(context, coverageResults, coverageProvider);
      }

      if (hasFailure) {
        const bail = context.normalizedConfig.bail;

        if (bail && context.stateManager.getCountOfFailedTests() >= bail) {
          logger.log(
            color.yellow(
              `Test run aborted due to reaching the bail limit of ${bail} failed test(s).`,
            ),
          );
        }
      }
    } finally {
      await browserClose?.();
    }
  };

  if (command === 'watch') {
    const enableCliShortcuts = isCliShortcutsEnabled();

    let isCleaningUp = false;

    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;

      try {
        await runGlobalTeardown();
        await pool.close();
        await closeServer();
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      // Exit with appropriate code (128 + signal number is Unix convention)
      process.exit(getSignalExitCode(signal));
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    process.on('SIGTSTP', handleSignal);

    const afterTestsWatchRun = () => {
      logger.log(color.green('  Waiting for file changes...'));

      if (enableCliShortcuts) {
        if (snapshotManager.summary.unmatched) {
          // highlight `u` when there are unmatched snapshots
          logger.log(
            `  ${color.dim('press')} ${color.yellow(color.bold('u'))} ${color.dim('to update snapshot')}${color.dim(', press')} ${color.bold('h')} ${color.dim('to show help')}\n`,
          );
        } else {
          logger.log(
            `  ${color.dim('press')} ${color.bold('h')} ${color.dim('to show help')}${color.dim(', press')} ${color.bold('q')} ${color.dim('to quit')}\n`,
          );
        }
      }
    };

    const { onBeforeRestart } = await import('./restart');

    onBeforeRestart(async () => {
      await runGlobalTeardown();
      await pool.close();
      await closeServer();
    });

    let buildStart: number | undefined;

    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      buildStart = Date.now();
      if (!isFirstCompile) {
        clearScreen();
      }
    });

    rsbuildInstance.onAfterDevCompile(async ({ isFirstCompile }) => {
      snapshotManager.clear();
      await run({ buildStart, mode: isFirstCompile ? 'all' : 'on-demand' });
      buildStart = undefined;

      if (isFirstCompile && enableCliShortcuts) {
        const closeCliShortcuts = await setupCliShortcuts(
          createWatchShortcutActions({
            afterTestsWatchRun,
            closeServer,
            context,
            globTestSourceEntries,
            pool,
            projects,
            run,
            snapshotManager,
          }),
        );

        onBeforeRestart(closeCliShortcuts);
      }

      afterTestsWatchRun();
    });
  } else {
    let isTeardown = false;
    let isCleaningUp = false;

    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;

      try {
        await runGlobalTeardown();
        await pool.close();
        await closeServer();
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const unExpectedExit = (code?: number) => {
      if (isTeardown) {
        logger.log(
          color.yellow(
            `Rstest exited unexpectedly with code ${code}, this is likely caused by test environment teardown.`,
          ),
        );
      } else {
        logger.log(
          color.red(
            `Rstest exited unexpectedly with code ${code}, terminating test run.`,
          ),
        );

        // Run global teardown before exit
        runGlobalTeardown().catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        });

        process.exitCode = 1;
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      // Exit with appropriate code (128 + signal number is Unix convention)
      process.exit(getSignalExitCode(signal));
    };

    process.on('exit', unExpectedExit);
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    process.on('SIGTSTP', handleSignal);

    try {
      await run();
      isTeardown = true;
      await pool.close();
      await closeServer();

      // Run global teardown after all tests are done
      await runGlobalTeardown();
    } finally {
      process.off('exit', unExpectedExit);
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      process.off('SIGTSTP', handleSignal);
    }
  }
}
