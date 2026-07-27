import {
  getNumCpus,
  parseWorkers,
  resolveWorkerCount,
} from '@rstest/core/internal/browser';
import type { Rstest } from '@rstest/core/internal/browser';

// Re-export the shared worker primitives so existing consumers (and unit tests
// importing from `../src/concurrency`) keep a stable import surface.
export { getNumCpus, parseWorkers };

// The browser headless path caps CPU-derived workers at 12 and halves that
// capped base in watch; the shared `resolveWorkerCount` helper owns the
// `maxWorkers` override and workload clamp.
const DEFAULT_MAX_HEADLESS_WORKERS = 12;

type HeadlessConcurrencyContext = Pick<Rstest, 'command'> & {
  normalizedConfig: {
    pool: {
      maxWorkers?: string | number;
    };
  };
};

const resolveHeadlessWorkerCount = ({
  command,
  maxWorkers,
  totalTasks,
  numCpus = getNumCpus(),
}: {
  command: HeadlessConcurrencyContext['command'];
  maxWorkers?: string | number;
  totalTasks: number;
  numCpus?: number;
}): number => {
  const base = Math.max(Math.min(DEFAULT_MAX_HEADLESS_WORKERS, numCpus - 1), 1);
  return resolveWorkerCount({
    command,
    maxWorkers,
    totalTasks,
    recommended: base,
    watchRecommended: Math.max(Math.floor(base / 2), 1),
    numCpus,
  });
};

export const resolveDefaultHeadlessWorkers = (
  command: HeadlessConcurrencyContext['command'],
  numCpus: number = getNumCpus(),
): number =>
  resolveHeadlessWorkerCount({
    command,
    totalTasks: Number.POSITIVE_INFINITY,
    numCpus,
  });

export const getHeadlessConcurrency = (
  context: HeadlessConcurrencyContext,
  totalTests: number,
): number =>
  resolveHeadlessWorkerCount({
    command: context.command,
    maxWorkers: context.normalizedConfig.pool.maxWorkers,
    totalTasks: totalTests,
  });
