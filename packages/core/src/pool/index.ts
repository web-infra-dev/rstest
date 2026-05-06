import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { basename, dirname, join, resolve } from 'pathe';
import type {
  CoverageMapData,
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
import {
  color,
  getForceColorEnv,
  isDeno,
  needFlagExperimentalDetectModule,
} from '../utils';
import { isMemorySufficient } from '../utils/memory';
import { Pool } from './pool';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
};

const getBufferedLogTaskId = (log: UserConsoleLog): string => {
  return log.taskId ?? getFileTaskId(log.testPath);
};

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
    silent,
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
    silent,
  };
};

const filterAssetsByEntry = async (
  entryInfo: EntryInfo,
  getAssetFiles: (names: string[]) => Promise<Record<string, string>>,
  getSourceMaps: (names: string[]) => Promise<Record<string, string>>,
  setupAssets: string[],
) => {
  const assetNames = Array.from(new Set([...entryInfo.files!, ...setupAssets]));
  const [neededFiles, neededSourceMaps] = await Promise.all([
    getAssetFiles(assetNames),
    getSourceMaps(assetNames),
  ]);

  return { assetFiles: neededFiles, sourceMaps: neededSourceMaps };
};

const getNodeExecArgv = () => {
  const suppressFile = join(__dirname, './rstestSuppressWarnings.cjs');

  return [
    '--experimental-vm-modules',
    '--experimental-import-meta-resolve',
    needFlagExperimentalDetectModule()
      ? '--experimental-detect-module'
      : undefined,
    '--require',
    suppressFile,
  ].filter(Boolean) as string[];
};

/** Shared parameter type for `runTests` and `collectTests`. */
type PoolDispatchParams = {
  entries: EntryInfo[];
  getAssetFiles: (names: string[]) => Promise<Record<string, string>>;
  getSourceMaps: (names: string[]) => Promise<Record<string, string>>;
  setupEntries: EntryInfo[];
  updateSnapshot: SnapshotUpdateState;
  project: ProjectContext;
};

/**
 * Build a `PoolTask` for a single entry.  Shared by `runTests` and
 * `collectTests` so the option-assembly logic lives in one place.
 */
const buildTask = async ({
  type,
  entryInfo,
  index,
  context,
  project,
  runtimeConfig,
  setupEntries,
  setupAssets,
  updateSnapshot,
  getAssetFiles,
  getSourceMaps,
  rpcMethods,
}: {
  type: 'run' | 'collect';
  entryInfo: EntryInfo;
  index: number;
  context: RstestContext;
  project: ProjectContext;
  runtimeConfig: RuntimeConfig;
  setupEntries: EntryInfo[];
  setupAssets: string[];
  updateSnapshot: SnapshotUpdateState;
  getAssetFiles: PoolDispatchParams['getAssetFiles'];
  getSourceMaps: PoolDispatchParams['getSourceMaps'];
  rpcMethods: Omit<RuntimeRPC, 'getAssetsByEntry'>;
}) => {
  const getAssets = () =>
    filterAssetsByEntry(entryInfo, getAssetFiles, getSourceMaps, setupAssets);

  return {
    worker: 'forks' as const,
    type,
    options: {
      entryInfo,
      context: {
        outputModule: project.outputModule,
        taskId: index + 1,
        project: project.name,
        rootPath: context.rootPath,
        projectRoot: project.rootPath,
        runtimeConfig,
      },
      type,
      setupEntries,
      updateSnapshot,
      /** assets is only defined when memory is sufficient, otherwise we should get them via rpc getAssetsByEntry method */
      assets: isMemorySufficient() ? await getAssets() : undefined,
    },
    rpcMethods: {
      ...rpcMethods,
      // getAssetsByEntry is only used when memory is not sufficient since it may be slow
      getAssetsByEntry: getAssets,
    },
  };
};

/**
 * Convert a worker crash or pool error into a fail-status `TestFileResult`.
 * Enriches the error with context about which test cases were running at the
 * time of the crash (if any).
 */
const workerErrorToResult = (
  err: unknown,
  testPath: string,
  projectName: string,
  context: RstestContext,
): TestFileResult => {
  const error = err instanceof Error ? err : new Error(String(err));

  (error as any).fullStack = true;
  if (error.message.includes('Worker exited unexpectedly')) {
    delete error.stack;
  }

  const runningModule = context.stateManager.runningModules.get(testPath);
  const runningTests = runningModule?.runningTests;

  if (runningTests?.length) {
    const getCaseName = (test: TestCaseInfo) =>
      `"${test.name}"${test.parentNames?.length ? ` (Under suite: ${test.parentNames?.join(' > ')})` : ''}`;

    const hint =
      runningTests.length === 1
        ? `Maybe relevant test case: ${getCaseName(runningTests[0]!)} which is running when the error occurs.`
        : `The below test cases may be relevant, as they were running when the error occurred:\n  - ${runningTests.map((t) => getCaseName(t)).join('\n  - ')}`;

    error.message += `\n\n${color.white(hint)}`;
  }

  return {
    testId: '0',
    project: projectName,
    testPath,
    status: 'fail',
    name: '',
    results: runningModule?.results || [],
    errors: [error],
  };
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
    /** When provided, coverage data is passed to this callback immediately for caller-owned merging. */
    onCoverageResult?: (coverage: CoverageMapData) => void;
  }) => Promise<{
    results: TestFileResult[];
    testResults: TestResult[];
  }>;
  collectTests: (params: PoolDispatchParams) => Promise<
    {
      tests: TestInfo[];
      testPath: string;
      errors?: FormattedError[];
      project: string;
    }[]
  >;
  close: () => Promise<void>;
}> => {
  const bufferedConsoleLogs = new Map<string, UserConsoleLog[]>();

  const emitUserConsoleLog = async (log: UserConsoleLog): Promise<void> => {
    await Promise.all(
      reporters.map((reporter) => reporter.onUserConsoleLog?.(log)),
    );
  };

  const bufferConsoleLog = (log: UserConsoleLog): void => {
    const taskId = getBufferedLogTaskId(log);
    const logs = bufferedConsoleLogs.get(taskId) || [];
    logs.push(log);
    bufferedConsoleLogs.set(taskId, logs);
  };

  const flushBufferedLogsForTask = async ({
    taskId,
    status,
  }: {
    taskId: string;
    status: TestResult['status'];
  }): Promise<void> => {
    const logs = bufferedConsoleLogs.get(taskId);
    if (!logs) {
      return;
    }

    bufferedConsoleLogs.delete(taskId);

    if (status !== 'fail') {
      return;
    }

    for (const log of logs) {
      await emitUserConsoleLog(log);
    }
  };

  // Propagate parent execArgv to workers, except flags known to cause issues
  // in child processes (--prof writes per-worker profiling logs, --title is
  // meaningless for workers). Safe for child_process.fork; the referenced
  // Node.js issue (#41103) only affects worker_threads.
  // https://github.com/nodejs/node/issues/41103
  const blockedFlags = ['--prof', '--title'];
  const execArgv = process.execArgv.filter((arg, i, arr) => {
    if (blockedFlags.some((f) => arg === f || arg.startsWith(`${f}=`))) {
      return false;
    }
    // skip standalone value following --title (handles `--title foo` form)
    if (i > 0 && arr[i - 1] === '--title') {
      return false;
    }
    return true;
  });

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

  const pool = new Pool({
    workerEntry: resolve(__dirname, './worker.js'),
    isolate,
    maxWorkers,
    minWorkers,
    execArgv: [
      ...(poolOptions?.execArgv ?? []),
      ...execArgv,
      ...(isDeno ? [] : getNodeExecArgv()),
    ],
    env: {
      NODE_ENV: 'test',
      ...getForceColorEnv(),
      ...process.env,
    } as Record<string, string>,
  });

  const createRpcMethods = ({
    runtimeConfig,
    projectConfig,
  }: {
    runtimeConfig: RuntimeConfig;
    projectConfig: ProjectContext['normalizedConfig'];
  }): Omit<RuntimeRPC, 'getAssetsByEntry'> => ({
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

      if (runtimeConfig.silent === 'passed-only') {
        await flushBufferedLogsForTask({
          taskId: result.testId,
          status: result.status,
        });
      }
    },
    getCountOfFailedTests: async (): Promise<number> => {
      return context.stateManager.getCountOfFailedTests();
    },
    onConsoleLog: async (log: UserConsoleLog) => {
      const shouldLog = runtimeConfig.disableConsoleIntercept
        ? true
        : projectConfig.onConsoleLog?.(log.content);

      if (shouldLog === false || runtimeConfig.silent === true) {
        return;
      }

      if (runtimeConfig.silent === 'passed-only') {
        bufferConsoleLog(log);
        return;
      }

      await emitUserConsoleLog(log);
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

      if (runtimeConfig.silent === 'passed-only') {
        await flushBufferedLogsForTask({
          taskId: result.testId,
          status: result.status,
        });
      }
    },
    resolveSnapshotPath: (testPath: string): string => {
      const snapExtension = '.snap';
      const resolver =
        projectConfig.resolveSnapshotPath ||
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
  });

  return {
    runTests: async ({
      entries,
      getAssetFiles,
      getSourceMaps,
      setupEntries,
      project,
      updateSnapshot,
      onCoverageResult,
    }) => {
      const projectName = project.name;
      const runtimeConfig = getRuntimeConfig(project);
      const rpcMethods = createRpcMethods({
        runtimeConfig,
        projectConfig: project.normalizedConfig,
      });
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      const results = await Promise.all(
        entries.map(async (entryInfo, index) => {
          const task = await buildTask({
            type: 'run',
            entryInfo,
            index,
            context,
            project,
            runtimeConfig,
            setupEntries,
            setupAssets,
            updateSnapshot,
            getAssetFiles,
            getSourceMaps,
            rpcMethods,
          });

          const result = await pool.runTest(task).catch((err: unknown) => {
            return workerErrorToResult(
              err,
              entryInfo.testPath,
              projectName,
              context,
            );
          });

          if (result.coverage) {
            onCoverageResult?.(result.coverage);
            delete result.coverage;
          }
          if (runtimeConfig.silent === 'passed-only') {
            await flushBufferedLogsForTask({
              taskId: result.testId,
              status: result.status,
            });
          }
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
      const rpcMethods = createRpcMethods({
        runtimeConfig,
        projectConfig: project.normalizedConfig,
      });
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      return Promise.all(
        entries.map(async (entryInfo, index) => {
          const task = await buildTask({
            type: 'collect',
            entryInfo,
            index,
            context,
            project,
            runtimeConfig,
            setupEntries,
            setupAssets,
            updateSnapshot,
            getAssetFiles,
            getSourceMaps,
            rpcMethods,
          });

          return pool.collectTests(task).catch((err: FormattedError) => {
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
