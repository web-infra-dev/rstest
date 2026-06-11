import { getNumCpus, parseWorkers } from '@rstest/core/internal/browser';
import type { Rstest } from '@rstest/core/internal/browser';

// Re-export the shared worker primitives so existing consumers (and unit tests
// importing from `../src/concurrency`) keep a stable import surface.
export { getNumCpus, parseWorkers };

// Shared headless concurrency policy.
// Keep this in one place so executors reuse the same worker semantics.
const DEFAULT_MAX_HEADLESS_WORKERS = 12;

type HeadlessConcurrencyContext = Pick<Rstest, 'command'> & {
  normalizedConfig: {
    pool: {
      maxWorkers?: string | number;
    };
  };
};

export const resolveDefaultHeadlessWorkers = (
  command: HeadlessConcurrencyContext['command'],
  numCpus: number = getNumCpus(),
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
