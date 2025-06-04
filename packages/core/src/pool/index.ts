import os from 'node:os';
import type {
  EntryInfo,
  FormattedError,
  RstestContext,
  SourceMapInput,
  Test,
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { serializableConfig } from '../utils';
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

/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/pool.ts
 */
export const createPool = async ({
  entries,
  context,
  assetFiles,
  setupEntries,
  sourceMaps,
}: {
  entries: EntryInfo[];
  setupEntries: EntryInfo[];
  assetFiles: Record<string, string>;
  sourceMaps: Record<string, SourceMapInput>;
  context: RstestContext;
}): Promise<{
  runTests: () => Promise<{
    results: TestFileResult[];
    testResults: TestResult[];
  }>;
  collectTests: () => Promise<
    Array<{
      tests: Test[];
      testPath: string;
      errors?: FormattedError[];
    }>
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

  const maxWorkers = poolOptions.maxWorkers
    ? parseWorkers(poolOptions.maxWorkers)
    : threadsCount;

  const minWorkers = poolOptions.minWorkers
    ? parseWorkers(poolOptions.minWorkers)
    : threadsCount;

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
    ],
    env: {
      NODE_ENV: 'test',
      // enable diff color by default
      FORCE_COLOR: '1',
      ...process.env,
    },
  });

  const { updateSnapshot } = context.snapshotManager.options;
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
  } = context.normalizedConfig;

  const runtimeConfig = {
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
  };

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

  const setupAssets = setupEntries.flatMap((entry) => entry.files);

  const filterAssetsByEntry = (entryInfo: EntryInfo) => {
    const neededFiles = entryInfo.files
      ? Object.fromEntries(
          Object.entries(assetFiles).filter(
            ([key]) =>
              entryInfo.files!.includes(key) || setupAssets.includes(key),
          ),
        )
      : assetFiles;

    const neededSourceMaps =
      Object.keys(entries).length > 1
        ? Object.fromEntries(
            Object.entries(sourceMaps).filter(([key]) => neededFiles[key]),
          )
        : sourceMaps;

    return { assetFiles: neededFiles, sourceMaps: neededSourceMaps };
  };
  return {
    runTests: async () => {
      const results = await Promise.all(
        entries.map((entryInfo) => {
          const { assetFiles, sourceMaps } = filterAssetsByEntry(entryInfo);

          return pool.runTest({
            options: {
              entryInfo,
              assetFiles,
              context: {
                rootPath: context.rootPath,
                runtimeConfig: serializableConfig(runtimeConfig),
              },
              type: 'run',
              sourceMaps,
              setupEntries,
              updateSnapshot,
            },
            rpcMethods,
          });
        }),
      );

      for (const result of results) {
        if (result.snapshotResult) {
          context.snapshotManager.add(result.snapshotResult);
        }
      }

      const testResults = results.flatMap((r) => r.results!);

      return { results, testResults };
    },
    collectTests: async () => {
      return Promise.all(
        entries.map((entryInfo) => {
          const { assetFiles, sourceMaps } = filterAssetsByEntry(entryInfo);

          return pool.collectTests({
            options: {
              entryInfo,
              assetFiles,
              context: {
                rootPath: context.rootPath,
                runtimeConfig: serializableConfig(runtimeConfig),
              },
              type: 'collect',
              sourceMaps,
              setupEntries,
              updateSnapshot,
            },
            rpcMethods,
          });
        }),
      );
    },
    close: () => pool.close(),
  };
};
