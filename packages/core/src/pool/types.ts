import type { RuntimeRPC, RunWorkerOptions } from '../types';
import type { MemoryGate } from './memoryGate';

export type PoolWorkerKind = 'forks' | 'threads';

export type PoolTask = {
  worker: PoolWorkerKind;
  type: 'run' | 'collect';
  options: RunWorkerOptions['options'];
  rpcMethods: RuntimeRPC;
};

/**
 * Isolation strategy for the pool. See `RstestConfig.isolate` for full docs.
 *   - `true`: fresh runner per task (process-per-file isolation)
 *   - `'soft'`: reuse runner across tasks; worker resets test env per task
 *   - `false`: reuse runner across tasks with no per-task reset
 */
export type IsolateMode = boolean | 'soft';

export type PoolOptions = {
  workerEntry: string;
  maxWorkers: number;
  minWorkers: number;
  isolate: IsolateMode;
  env?: Record<string, string>;
  execArgv?: string[];
  /**
   * Whether to forward worker stdio to the host process. Defaults to `true`
   * to preserve Tinypool parity (native crash logs / warnings stay visible).
   * Set to `false` in tests that intentionally write crash-like output to
   * stderr so the simulated noise doesn't leak into the host log.
   */
  forwardStdio?: boolean;
  /**
   * Memory-aware spawn gate. Omit or pass `undefined` to disable (used by
   * unit tests that need deterministic spawn timing). `createPool` injects
   * a fresh `MemoryGate` by default.
   */
  memoryGate?: MemoryGate;
};
