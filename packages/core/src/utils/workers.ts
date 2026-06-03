import os from 'node:os';

export const getNumCpus = (): number => {
  return os.availableParallelism?.() ?? os.cpus().length;
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
