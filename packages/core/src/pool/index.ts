import os from 'node:os';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { basename, dirname, join } from 'pathe';
import type {
  EntryInfo,
  FormattedError,
  ProjectContext,
  RstestContext,
  RuntimeConfig,
  RuntimeRPC,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestInfo,
  TestResult,
  TestSuiteInfo,
  UserConsoleLog,
} from '../types';
import { color, needFlagExperimentalDetectModule } from '../utils';
import { isMemorySufficient } from '../utils/memory';
import { createForksPool } from './forks';

const getNumCpus = (): number => {
  return os.availableParallelism?.() ?? os.cpus().length;
};

const parseWorkers = (maxWorkers: string | number): number => {
  const parsed = Number.parseInt(maxWorkers.toString(), 10);

  if (typeof maxWorkers === 'string' && maxWorkers.trim().endsWith('%')) {
    const numCpus = getNumCpus();
    const workers = Math.floor((parsed / 100) * numCpus);
    return Math.max(workers, 1);
  }

  return parsed > 0 ? parsed : 1;
};

const getRuntimeConfig = (context: ProjectContext): RuntimeConfig => {
  const {
    testNamePattern,
    testTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    testEnvironment,
    hookTimeout,
    isolate,
    coverage,
    snapshotFormat,
    env,
    logHeapUsage,
    bail,
    chaiConfig,
    includeTaskLocation,
  } = context.normalizedConfig;

  return {
    env: {
      // get process.env correctly when globalSetup modified it
      ...process.env,
      ...env,
    },
    testNamePattern,
    testTimeout,
    hookTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    testEnvironment,
    isolate,
    coverage: { ...coverage, reporters: [] }, // reporters may be functions so remove it
    snapshotFormat,
    logHeapUsage,
    bail,
    chaiConfig,
    includeTaskLocation,
  };
};

const filterAssetsByEntry = async (
  entryInfo: EntryInfo,
  getAssetFiles: (names: string[]) => Promise<Record<string, string>>,
  getSourceMaps: (names: string[]) => Promise<Record<string, string>>,
  setupAssets: string[],
) => {
  const assetNames = Array.from(new Set([...entryInfo.files!, ...setupAssets]));
  const neededFiles = await getAssetFiles(assetNames);

  const neededSourceMaps = await getSourceMaps(assetNames);

  return { assetFiles: neededFiles, sourceMaps: neededSourceMaps };
};

export const createPool = async ({
  context,
  recommendWorkerCount = Number.POSITIVE_INFINITY,
}: {
  context: RstestContext;
  recommendWorkerCount?: number;
}): Promise<{
  runTests: (params: {
    entries: EntryInfo[];
    getAssetFiles: (names: string[]) => Promise<Record<string, string>>;
    getSourceMaps: (names: string[]) => Promise<Record<string, string>>;
    setupEntries: EntryInfo[];
    updateSnapshot: SnapshotUpdateState;
    project: ProjectContext;
  }) => Promise<{
    results: TestFileResult[];
    testResults: TestResult[];
  }>;
  collectTests: (params: {
    entries: EntryInfo[];
    getAssetFiles: (names: string[]) => Promise<Record<string, string>>;
    getSourceMaps: (names: string[]) => Promise<Record<string, string>>;
    setupEntries: EntryInfo[];
    updateSnapshot: SnapshotUpdateState;
    project: ProjectContext;
  }) => Promise<
    {
      tests: TestInfo[];
      testPath: string;
      errors?: FormattedError[];
      project: string;
    }[]
  >;
  close: () => Promise<void>;
}> => {
  // Some options may crash worker, e.g. --prof, --title.
  // https://github.com/nodejs/node/issues/41103
  const execArgv = process.execArgv.filter(
    (execArg) =>
      execArg.startsWith('--perf') ||
      execArg.startsWith('--cpu-prof') ||
      execArg.startsWith('--heap-prof') ||
      execArg.startsWith('--diagnostic-dir'),
  );

  const numCpus = getNumCpus();

  const {
    normalizedConfig: { pool: poolOptions, isolate },
    reporters,
  } = context;

  const threadsCount =
    context.command === 'watch'
      ? Math.max(Math.floor(numCpus / 2), 1)
      : Math.max(numCpus - 1, 1);

  // Avoid creating unused workers when the number of tests is less than the default thread count.
  const recommendCount =
    context.command === 'watch'
      ? threadsCount
      : Math.min(recommendWorkerCount, threadsCount);

  const maxWorkers = poolOptions.maxWorkers
    ? parseWorkers(poolOptions.maxWorkers)
    : recommendCount;

  const minWorkers = poolOptions.minWorkers
    ? parseWorkers(poolOptions.minWorkers)
    : maxWorkers < recommendCount
      ? maxWorkers
      : recommendCount;

  if (maxWorkers < minWorkers) {
    throw `Invalid pool configuration: maxWorkers(${maxWorkers}) cannot be less than minWorkers(${minWorkers}).`;
  }

  const pool = createForksPool({
    ...poolOptions,
    isolate,
    maxWorkers,
    minWorkers,
    execArgv: [
      ...(poolOptions?.execArgv ?? []),
      ...execArgv,
      '--experimental-vm-modules',
      '--experimental-import-meta-resolve',
      '--no-warnings',
      needFlagExperimentalDetectModule()
        ? '--experimental-detect-module'
        : undefined,
    ].filter(Boolean) as string[],
    env: {
      NODE_ENV: 'test',
      // enable diff color by default
      FORCE_COLOR: process.env.NO_COLOR === '1' ? '0' : '1',
    },
  });

  const rpcMethods: Omit<RuntimeRPC, 'getAssetsByEntry'> = {
    onTestCaseStart: async (test: TestCaseInfo) => {
      context.stateManager.onTestCaseStart(test);
      Promise.all(
        reporters.map((reporter) => reporter.onTestCaseStart?.(test)),
      );
    },
    onTestCaseResult: async (result: TestResult) => {
      context.stateManager.onTestCaseResult(result);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestCaseResult?.(result)),
      );
    },
    getCountOfFailedTests: async (): Promise<number> => {
      return context.stateManager.getCountOfFailedTests();
    },
    onConsoleLog: async (log: UserConsoleLog) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onUserConsoleLog?.(log)),
      );
    },
    onTestFileStart: async (test: TestFileInfo) => {
      context.stateManager.onTestFileStart(test.testPath);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileStart?.(test)),
      );
    },
    onTestFileReady: async (test: TestFileInfo) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileReady?.(test)),
      );
    },
    onTestSuiteStart: async (test: TestSuiteInfo) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestSuiteStart?.(test)),
      );
    },
    onTestSuiteResult: async (result: TestResult) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestSuiteResult?.(result)),
      );
    },
    resolveSnapshotPath: (testPath: string): string => {
      const snapExtension = '.snap';
      const resolver =
        context.normalizedConfig.resolveSnapshotPath ||
        // test/index.ts -> test/__snapshots__/index.ts.snap
        (() =>
          join(
            dirname(testPath),
            '__snapshots__',
            `${basename(testPath)}${snapExtension}`,
          ));

      const snapshotPath = resolver(testPath, snapExtension);
      return snapshotPath;
    },
  };

  return {
    runTests: async ({
      entries,
      getAssetFiles,
      getSourceMaps,
      setupEntries,
      project,
      updateSnapshot,
    }) => {
      const projectName = context.normalizedConfig.name;
      const runtimeConfig = getRuntimeConfig(project);
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      const results = await Promise.all(
        entries.map(async (entryInfo, index) => {
          const result = await pool
            .runTest({
              options: {
                entryInfo,
                context: {
                  outputModule: project.outputModule,
                  taskId: index + 1,
                  project: projectName,
                  rootPath: context.rootPath,
                  projectRoot: project.rootPath,
                  runtimeConfig,
                },
                type: 'run',
                setupEntries,
                updateSnapshot,
                /** assets is only defined when memory is sufficient, otherwise we should get them via rpc getAssetsByEntry method */
                assets: isMemorySufficient()
                  ? await filterAssetsByEntry(
                      entryInfo,
                      getAssetFiles,
                      getSourceMaps,
                      setupAssets,
                    )
                  : undefined,
              },
              rpcMethods: {
                ...rpcMethods,
                // getAssetsByEntry is only used when memory is not sufficient since it may be slow
                getAssetsByEntry: async () =>
                  filterAssetsByEntry(
                    entryInfo,
                    getAssetFiles,
                    getSourceMaps,
                    setupAssets,
                  ),
              },
            })
            .catch((err: unknown) => {
              (err as any).fullStack = true;
              if (err instanceof Error) {
                if (err.message.includes('Worker exited unexpectedly')) {
                  delete err.stack;
                }
                const runningModule = context.stateManager.runningModules.get(
                  entryInfo.testPath,
                );
                if (runningModule?.runningTests.length) {
                  const getCaseName = (test: TestCaseInfo) =>
                    `"${test.name}"${test.parentNames?.length ? ` (Under suite: ${test.parentNames?.join(' > ')})` : ''}`;
                  if (runningModule?.runningTests.length === 1) {
                    err.message += `\n\n${color.white(`Maybe relevant test case: ${getCaseName(runningModule.runningTests[0]!)} which is running when the error occurs.`)}`;
                  } else {
                    err.message += `\n\n${color.white(`The below test cases may be relevant, as they were running when the error occurred:\n  - ${runningModule.runningTests.map((t) => getCaseName(t)).join('\n  - ')}`)}`;
                  }
                }

                return {
                  testId: '0',
                  project: projectName,
                  testPath: entryInfo.testPath,
                  status: 'fail',
                  name: '',
                  results: runningModule?.results || [],
                  errors: [err],
                } as TestFileResult;
              }

              return {
                testId: '0',
                project: projectName,
                testPath: entryInfo.testPath,
                status: 'fail',
                name: '',
                results: [],
                errors: [err],
              } as TestFileResult;
            });
          context.stateManager.onTestFileResult(result);
          reporters.map((reporter) => reporter.onTestFileResult?.(result));
          return result;
        }),
      );

      for (const result of results) {
        if (result.snapshotResult) {
          context.snapshotManager.add(result.snapshotResult);
        }
      }

      const testResults = results.flatMap((r) => r.results);

      return { results, testResults, project };
    },
    collectTests: async ({
      entries,
      getAssetFiles,
      getSourceMaps,
      setupEntries,
      project,
      updateSnapshot,
    }) => {
      const runtimeConfig = getRuntimeConfig(project);
      const projectName = project.normalizedConfig.name;

      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      return Promise.all(
        entries.map(async (entryInfo, index) => {
          return pool
            .collectTests({
              options: {
                entryInfo,
                context: {
                  taskId: index + 1,
                  project: projectName,
                  outputModule: project.outputModule,
                  rootPath: context.rootPath,
                  projectRoot: project.rootPath,
                  runtimeConfig,
                },
                type: 'collect',
                setupEntries,
                updateSnapshot,
                assets: isMemorySufficient()
                  ? await filterAssetsByEntry(
                      entryInfo,
                      getAssetFiles,
                      getSourceMaps,
                      setupAssets,
                    )
                  : undefined,
              },
              rpcMethods: {
                ...rpcMethods,
                getAssetsByEntry: async () =>
                  filterAssetsByEntry(
                    entryInfo,
                    getAssetFiles,
                    getSourceMaps,
                    setupAssets,
                  ),
              },
            })
            .catch((err: FormattedError) => {
              err.fullStack = true;
              return {
                project: projectName,
                testPath: entryInfo.testPath,
                tests: [],
                errors: [err],
              };
            });
        }),
      );
    },
    close: () => pool.close(),
  };
};
