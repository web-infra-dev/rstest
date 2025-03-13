import os from 'node:os';
import type { TestSuiteResult } from '../runner';
import type { EntryInfo, RstestContext } from '../types';
import { color, logger } from '../utils';
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

export const runInPool = async (
  entryInfo: EntryInfo[],
  context: RstestContext,
): Promise<void> => {
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
    normalizedConfig: { pool: poolOptions },
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
    maxWorkers,
    minWorkers,
    execArgv: [...(poolOptions?.execArgv ?? []), ...execArgv],
    env: {
      NODE_ENV: 'test',
      ...process.env,
    },
  });

  const results = await Promise.all(
    entryInfo.map((entry) => pool.runTest(entry)),
  );

  const testResults = results.flatMap((r) => r.results!);

  if (testResults.some((r) => r.status === 'fail')) {
    process.exitCode = 1;
  }

  logger.log(` ${color.gray('Test Files')} ${getStatusString(results)}`);
  logger.log(`       ${color.gray('Test')} ${getStatusString(testResults)}`);
  logger.log('');
};

export function getStatusString(
  tasks: TestSuiteResult[],
  name = 'tests',
  showTotal = true,
): string {
  if (tasks.length === 0) {
    return color.dim(`no ${name}`);
  }

  const passed = tasks.filter((result) => result.status === 'pass');
  const failed = tasks.filter((result) => result.status === 'fail');
  const skipped = tasks.filter((result) => result.status === 'skip');
  const todo = tasks.filter((result) => result.status === 'todo');

  return (
    [
      failed.length ? color.bold(color.red(`${failed.length} failed`)) : null,
      passed.length ? color.bold(color.green(`${passed.length} passed`)) : null,
      skipped.length ? color.yellow(`${skipped.length} skipped`) : null,
      todo.length ? color.gray(`${todo.length} todo`) : null,
    ]
      .filter(Boolean)
      .join(color.dim(' | ')) +
    (showTotal ? color.gray(` (${tasks.length})`) : '')
  );
}
