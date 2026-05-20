import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Record this file's `process.pid` + the file's tag into a shared log.
 * The driver reads this back after the fixture run and asserts the pid
 * count matches the file count — proving the runner was disposed after
 * each task (the configured `maxFilesPerWorker: 1` cap).
 */
export const PID_LOG_PATH =
  process.env.RSTEST_SOFT_RECYCLE_LOG ??
  join(tmpdir(), 'rstest-soft-mode-recycle.log');

export const recordPid = (fileTag: string): void => {
  appendFileSync(PID_LOG_PATH, `${process.pid}\t${fileTag}\n`);
};
