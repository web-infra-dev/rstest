import type { RuntimeRPC, RunWorkerOptions } from '../types';
import type { MemoryGate } from './memoryGate';
import type { TestEnvironmentModuleFallback } from './protocol';

export type PoolWorkerKind = 'forks' | 'threads';

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
  getEnv?: () => Record<string, string>;
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
  /** Receives each distinct environment prebundle fallback once. */
  onTestEnvironmentFallback?: (fallback: TestEnvironmentModuleFallback) => void;
};
