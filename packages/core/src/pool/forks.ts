import { resolve } from 'node:path';
import { type Options, Tinypool } from 'tinypool';
import type { EntryInfo } from '../types';

export const createForksPool = (
  poolOptions: {
    env?: Record<string, string>;
    maxWorkers?: number;
    minWorkers?: number;
    execArgv?: string[];
  } = {},
): {
  name: string;
  runTest: (entryInfo: EntryInfo) => Promise<void>;
  close: () => Promise<void>;
} => {
  const {
    maxWorkers: maxThreads,
    minWorkers: minThreads,
    env,
    execArgv = [],
  } = poolOptions;

  const options: Options = {
    runtime: 'child_process',
    filename: resolve(import.meta.dirname, './worker.js'),
    env,
    execArgv,
    maxThreads,
    minThreads,
    concurrentTasksPerWorker: 1,
  };

  const pool = new Tinypool(options);

  return {
    name: 'forks',
    runTest: (entryInfo: EntryInfo) => pool.run(entryInfo),
    close: () => pool.destroy(),
  };
};
