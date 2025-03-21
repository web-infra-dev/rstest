import os from 'node:os';
import type {
  EntryInfo,
  RstestContext,
  TestResult,
  TestSuiteResult,
} from '../types';
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

export const runInPool = async ({
  entries,
  context,
  assetFiles,
}: {
  entries: EntryInfo[];
  assetFiles: Record<string, string>;
  context: RstestContext;
}): Promise<{
  results: TestResult[];
  testResults: TestSuiteResult[];
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
    execArgv: [...(poolOptions?.execArgv ?? []), ...execArgv],
    env: {
      NODE_ENV: 'test',
      ...process.env,
    },
  });

  const results = await Promise.all(
    entries.map((entryInfo) =>
      pool.runTest({
        options: { entryInfo, assetFiles, context },
        rpcMethods: {},
      }),
    ),
  );

  const testResults = results.flatMap((r) => r.results!);

  return { results, testResults };
};
