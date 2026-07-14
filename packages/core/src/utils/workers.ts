import os from 'node:os';
import type { RstestCommand } from '../types';

export const getNumCpus = (): number => {
  return os.availableParallelism?.() ?? os.cpus().length;
};

export interface ResolveWorkerCountOptions {
  /** Run command; `'watch'` halves the CPU-derived recommendation. */
  command: RstestCommand;
  /** Explicit `pool.maxWorkers`; overrides the CPU-derived recommendation. */
  maxWorkers?: string | number;
  /**
   * Workload upper bound (test file count). The result never exceeds it, so we
   * never spin more workers than there are files. Pass `Infinity` to opt out
   * (the node pool does this in watch to keep warm workers across reruns).
   */
  totalTasks: number;
  /**
   * Optional hard ceiling on the CPU-derived worker count. The browser headless
   * path passes `12`; the node pool passes none (bounded only by `numCpus - 1`).
   */
  defaultCap?: number;
  numCpus?: number;
}

/**
 * Shared worker-count policy for both executors — the node pool (`pool/index.ts`)
 * and the browser headless scheduler (`@rstest/browser` `concurrency.ts`). Both
 * derive a recommendation from the CPU count, halve it in watch, cap it, and
 * clamp it to the workload; centralizing that here stops the two sites from
 * duplicating (and drifting on) the formula.
 */
export const resolveWorkerCount = ({
  command,
  maxWorkers,
  totalTasks,
  defaultCap,
  numCpus = getNumCpus(),
}: ResolveWorkerCountOptions): number => {
  const clamp = (value: number): number =>
    Math.max(Math.min(value, totalTasks), 1);

  if (maxWorkers != null) {
    return clamp(parseWorkers(maxWorkers, numCpus));
  }

  const base = Math.max(
    Math.min(defaultCap ?? Number.POSITIVE_INFINITY, numCpus - 1),
    1,
  );
  // Historical formulas, preserved exactly: the node pool (no `defaultCap`)
  // halves the raw CPU count in watch — floor(numCpus / 2) — while the browser
  // headless path halves its capped base — floor(min(cap, numCpus - 1) / 2).
  const recommended =
    command === 'watch'
      ? Math.max(Math.floor((defaultCap != null ? base : numCpus) / 2), 1)
      : base;
  return clamp(recommended);
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
