import os from 'node:os';
import type {
  EntryInfo,
  RstestContext,
  SourceMapInput,
  TestFileResult,
  TestResult,
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
export const runInPool = async ({
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
  results: TestFileResult[];
  testResults: TestResult[];
}> => {
  // Some options may crash worker, e.g. --prof, --title.
  // https://github.com/nodejs/node/issues/41103
  const execArgv = process.execArgv.filter(
    (execArg) =>
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
  };

  const results = await Promise.all(
    entries.map((entryInfo) =>
      pool.runTest({
        options: {
          entryInfo,
          assetFiles,
          context: {
            rootPath: context.rootPath,
            runtimeConfig: serializableConfig(runtimeConfig),
          },
          sourceMaps,
          setupEntries,
          updateSnapshot,
        },
        rpcMethods: {
          onTestCaseResult: async (result) => {
            await Promise.all(
              reporters.map((reporter) => reporter.onTestCaseResult?.(result)),
            );
          },
          onConsoleLog: async (log) => {
            await Promise.all(
              reporters.map((reporter) => reporter.onConsoleLog?.(log)),
            );
          },
          onTestFileStart: async (test) => {
            await Promise.all(
              reporters.map((reporter) => reporter.onTestFileStart?.(test)),
            );
          },
        },
      }),
    ),
  );

  for (const result of results) {
    if (result.snapshotResult) {
      context.snapshotManager.add(result.snapshotResult);
    }
  }

  const testResults = results.flatMap((r) => r.results!);

  return { results, testResults };
};
