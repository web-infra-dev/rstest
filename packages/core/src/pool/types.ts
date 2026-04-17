import type { RuntimeRPC, RunWorkerOptions } from '../types';

export type PoolWorkerKind = 'forks';

export type PoolTask = {
  worker: PoolWorkerKind;
  type: 'run' | 'collect';
  options: RunWorkerOptions['options'];
  rpcMethods: RuntimeRPC;
};

export type PoolOptions = {
  workerEntry: string;
  maxWorkers: number;
  minWorkers: number;
  isolate: boolean;
  env?: Record<string, string>;
  execArgv?: string[];
};
