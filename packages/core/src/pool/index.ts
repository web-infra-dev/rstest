import os from 'node:os';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import type {
  EntryInfo,
  FormattedError,
  ProjectContext,
  RstestContext,
  RuntimeConfig,
  SourceMapInput,
  Test,
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { needFlagExperimentalDetectModule, serializableConfig } from '../utils';
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
  } = context.normalizedConfig;

  return {
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
  };
};

const filterAssetsByEntry = (
  entryInfo: EntryInfo,
  assetFiles: Record<string, string>,
  setupAssets: string[],
  sourceMaps: Record<string, SourceMapInput>,
  entryLength: number,
) => {
  const neededFiles =
    entryLength > 1 && entryInfo.files
      ? Object.fromEntries(
          Object.entries(assetFiles).filter(
            ([key]) =>
              entryInfo.files!.includes(key) || setupAssets.includes(key),
          ),
        )
      : assetFiles;

  const neededSourceMaps =
    entryLength > 1
      ? Object.fromEntries(
          Object.entries(sourceMaps).filter(([key]) => neededFiles[key]),
        )
      : sourceMaps;

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
    assetFiles: Record<string, string>;
    setupEntries: EntryInfo[];
    sourceMaps: Record<string, SourceMapInput>;
    updateSnapshot: SnapshotUpdateState;
    project: ProjectContext;
  }) => Promise<{
    results: TestFileResult[];
    testResults: TestResult[];
  }>;
  collectTests: (params: {
    entries: EntryInfo[];
    assetFiles: Record<string, string>;
    setupEntries: EntryInfo[];
    sourceMaps: Record<string, SourceMapInput>;
    updateSnapshot: SnapshotUpdateState;
    project: ProjectContext;
  }) => Promise<
    {
      tests: Test[];
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
      ...process.env,
    },
  });

  const rpcMethods = {
    onTestCaseResult: async (result: TestResult) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestCaseResult?.(result)),
      );
    },
    onConsoleLog: async (log: UserConsoleLog) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onUserConsoleLog?.(log)),
      );
    },
    onTestFileStart: async (test: TestFileInfo) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileStart?.(test)),
      );
    },
    onTestFileResult: async (test: TestFileResult) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileResult?.(test)),
      );
    },
  };

  return {
    runTests: async ({
      entries,
      assetFiles,
      setupEntries,
      sourceMaps,
      project,
      updateSnapshot,
    }) => {
      const projectName = context.normalizedConfig.name;
      const runtimeConfig = getRuntimeConfig(project);
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);
      const entryLength = Object.keys(entries).length;

      const results = await Promise.all(
        entries.map((entryInfo) => {
          const { assetFiles: neededFiles, sourceMaps: neededSourceMaps } =
            filterAssetsByEntry(
              entryInfo,
              assetFiles,
              setupAssets,
              sourceMaps,
              entryLength,
            );

          return pool
            .runTest({
              options: {
                entryInfo,
                assetFiles: neededFiles,
                context: {
                  project: projectName,
                  rootPath: context.rootPath,
                  runtimeConfig: serializableConfig(runtimeConfig),
                },
                type: 'run',
                sourceMaps: neededSourceMaps,
                setupEntries,
                updateSnapshot,
              },
              rpcMethods,
            })
            .catch((err: unknown) => {
              (err as any).fullStack = true;
              return {
                project: projectName,
                testPath: entryInfo.testPath,
                status: 'fail',
                name: '',
                results: [],
                errors: [err],
              } as TestFileResult;
            });
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
      assetFiles,
      setupEntries,
      sourceMaps,
      project,
      updateSnapshot,
    }) => {
      const runtimeConfig = getRuntimeConfig(project);
      const projectName = project.normalizedConfig.name;

      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);
      const entryLength = Object.keys(entries).length;

      return Promise.all(
        entries.map((entryInfo) => {
          const { assetFiles: neededFiles, sourceMaps: neededSourceMaps } =
            filterAssetsByEntry(
              entryInfo,
              assetFiles,
              setupAssets,
              sourceMaps,
              entryLength,
            );

          return pool
            .collectTests({
              options: {
                entryInfo,
                assetFiles: neededFiles,
                context: {
                  project: projectName,
                  rootPath: context.rootPath,
                  runtimeConfig: serializableConfig(runtimeConfig),
                },
                type: 'collect',
                sourceMaps: neededSourceMaps,
                setupEntries,
                updateSnapshot,
              },
              rpcMethods,
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
