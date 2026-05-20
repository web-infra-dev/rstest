import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Record this file's process.pid + the file's name into a shared log
 * file. The driver test reads the log after the fixture finishes and
 * asserts that fewer unique pids exist than files — proving the worker
 * pool reused workers across files.
 *
 * Cannot use `globalThis` because each worker process has its own
 * global, so a counter there is per-worker not workspace-wide.
 */
export const PID_LOG_PATH =
  process.env.RSTEST_SOFT_REUSE_LOG ??
  join(tmpdir(), 'rstest-soft-mode-reuse.log');

export const recordPid = (fileTag: string): void => {
  appendFileSync(PID_LOG_PATH, `${process.pid}\t${fileTag}\n`);
};
