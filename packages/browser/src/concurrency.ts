import {
  getNumCpus,
  parseWorkers,
  resolveWorkerCount,
} from '@rstest/core/internal/browser';
import type { Rstest } from '@rstest/core/internal/browser';

// Re-export the shared worker primitives so existing consumers (and unit tests
// importing from `../src/concurrency`) keep a stable import surface.
export { getNumCpus, parseWorkers };

// The browser headless path caps CPU-derived workers at 12; the shared
// `resolveWorkerCount` helper owns the clamp/halve-in-watch formula.
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
): number =>
  resolveWorkerCount({
    command,
    totalTasks: Number.POSITIVE_INFINITY,
    defaultCap: DEFAULT_MAX_HEADLESS_WORKERS,
    numCpus,
  });

export const getHeadlessConcurrency = (
  context: HeadlessConcurrencyContext,
  totalTests: number,
): number =>
  resolveWorkerCount({
    command: context.command,
    maxWorkers: context.normalizedConfig.pool.maxWorkers,
    totalTasks: totalTests,
    defaultCap: DEFAULT_MAX_HEADLESS_WORKERS,
  });
