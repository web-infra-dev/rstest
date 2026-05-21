import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Record this file's `process.pid` into a shared log. The driver reads
 * the log after the fixture finishes and asserts unique pids — proving
 * the worker was recycled between tasks (the configured `memoryLimit:
 * 2` byte cap is blown on every task, so every runner is disposed and
 * a fresh one spawned).
 */
export const PID_LOG_PATH =
  process.env.RSTEST_MEMLIMIT_LOG ?? join(tmpdir(), 'rstest-memory-limit.log');

export const recordPid = (fileTag: string): void => {
  appendFileSync(PID_LOG_PATH, `${process.pid}\t${fileTag}\n`);
};
