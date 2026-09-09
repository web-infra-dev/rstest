import { appendFileSync } from 'node:fs';
import { threadId } from 'node:worker_threads';

export const recordPid = (fileTag: string): void => {
  appendFileSync(
    process.env.RSTEST_MEMLIMIT_LOG!,
    `${process.pid}:${threadId}\t${fileTag}\n`,
  );
};
