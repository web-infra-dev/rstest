import os from 'node:os';
import type { RstestCommand } from '../types';

export const getNumCpus = (): number => {
  return os.availableParallelism?.() ?? os.cpus().length;
};

export interface ResolveWorkerCountOptions {
  /** Run command; `'watch'` selects `watchRecommended`. */
  command: RstestCommand;
  /** Explicit `pool.maxWorkers`; overrides the CPU-derived recommendation. */
  maxWorkers?: string | number;
  /**
   * Workload upper bound (test file count). The result never exceeds it, so we
   * never schedule more workers than there are files. Pass `Infinity` to opt
   * out.
   */
  totalTasks: number;
  /** The caller's CPU-derived recommendation outside watch. */
  recommended: number;
  /** The caller's recommendation in watch (typically half its own base). */
  watchRecommended: number;
  /** Used only to resolve a percentage `maxWorkers`. */
  numCpus?: number;
}

/**
 * Worker-count policy for schedulers that eagerly start a fixed number of
 * workers. The caller supplies its CPU-derived recommendations; an explicit
 * `maxWorkers` always wins, and the result stays within `[1, totalTasks]`.
 */
export const resolveWorkerCount = ({
  command,
  maxWorkers,
  totalTasks,
  recommended,
  watchRecommended,
  numCpus,
}: ResolveWorkerCountOptions): number => {
  const clamp = (value: number): number =>
    Math.max(Math.min(value, totalTasks), 1);

  if (maxWorkers != null) {
    return clamp(parseWorkers(maxWorkers, numCpus));
  }

  return clamp(command === 'watch' ? watchRecommended : recommended);
};

export const parseWorkers = (
  maxWorkers: string | number,
  numCpus?: number,
): number => {
  const parsed = Number.parseInt(maxWorkers.toString(), 10);

  if (typeof maxWorkers === 'string' && maxWorkers.trim().endsWith('%')) {
    // Resolve the CPU count lazily — only the percentage path needs it.
    const workers = Math.floor((parsed / 100) * (numCpus ?? getNumCpus()));
    return Math.max(workers, 1);
  }

  return parsed > 0 ? parsed : 1;
};
