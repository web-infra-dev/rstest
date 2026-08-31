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

/**
 * Resolve a VM worker memory limit using the same units as Vitest/Jest:
 * numbers in (0, 1] are percentages of machine memory, larger numbers are
 * bytes, and strings may use %, KB/KiB, MB/MiB, or GB/GiB suffixes.
 */
export const parseMemoryLimit = (
  memoryLimit: number | string,
  totalMemory: number = os.totalmem(),
): number => {
  if (typeof memoryLimit === 'number') {
    if (memoryLimit > 0 && memoryLimit <= 1) {
      return Math.floor(memoryLimit * totalMemory);
    }
    if (memoryLimit > 1) {
      return Math.floor(memoryLimit);
    }
    throw new Error('pool.memoryLimit must be greater than 0');
  }

  const value = memoryLimit.trim().toLowerCase();
  const match = value.match(
    /^([0-9]+(?:\.[0-9]+)?)\s*(%|k|kb|kib|m|mb|mib|g|gb|gib)?$/,
  );
  if (!match) {
    throw new Error(`Invalid pool.memoryLimit: ${memoryLimit}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'bytes';
  const multiplier =
    unit === '%'
      ? totalMemory / 100
      : unit === 'k' || unit === 'kb'
        ? 1000
        : unit === 'kib'
          ? 1024
          : unit === 'm' || unit === 'mb'
            ? 1000 ** 2
            : unit === 'mib'
              ? 1024 ** 2
              : unit === 'g' || unit === 'gb'
                ? 1000 ** 3
                : unit === 'gib'
                  ? 1024 ** 3
                  : 1;
  const resolved = Math.floor(amount * multiplier);
  if (resolved <= 0) {
    throw new Error('pool.memoryLimit must be greater than 0');
  }
  return resolved;
};
