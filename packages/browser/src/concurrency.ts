import os from 'node:os';
import type { Rstest } from '@rstest/core/browser';

// Shared headless concurrency policy.
// Keep this in one place so executors reuse the same worker semantics.
const DEFAULT_MAX_HEADLESS_WORKERS = 12;

export type HeadlessConcurrencyContext = Pick<Rstest, 'command'> & {
  normalizedConfig: {
    pool: {
      maxWorkers?: string | number;
    };
  };
};

export const getNumCpus = (): number => {
  return os.availableParallelism?.() ?? os.cpus().length;
};

export const parseWorkers = (
  maxWorkers: string | number,
  numCpus = getNumCpus(),
): number => {
  const parsed = Number.parseInt(maxWorkers.toString(), 10);

  if (typeof maxWorkers === 'string' && maxWorkers.trim().endsWith('%')) {
    const workers = Math.floor((parsed / 100) * numCpus);
    return Math.max(workers, 1);
  }

  return parsed > 0 ? parsed : 1;
};

export const resolveDefaultHeadlessWorkers = (
  command: HeadlessConcurrencyContext['command'],
  numCpus = getNumCpus(),
): number => {
  const baseWorkers = Math.max(
    Math.min(DEFAULT_MAX_HEADLESS_WORKERS, numCpus - 1),
    1,
  );

  return command === 'watch'
    ? Math.max(Math.floor(baseWorkers / 2), 1)
    : baseWorkers;
};

export const getHeadlessConcurrency = (
  context: HeadlessConcurrencyContext,
  totalTests: number,
): number => {
  if (totalTests <= 0) {
    return 1;
  }

  const maxWorkers = context.normalizedConfig.pool.maxWorkers;
  if (maxWorkers !== undefined) {
    return Math.min(parseWorkers(maxWorkers), totalTests);
  }

  return Math.min(resolveDefaultHeadlessWorkers(context.command), totalTests);
};
