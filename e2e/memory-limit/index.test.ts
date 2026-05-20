import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('pool.memoryLimit — heap-based worker recycle', () => {
  it('recycles the worker when its RSS exceeds the cap', async ({
    onTestFinished,
  }) => {
    const logPath = join(
      tmpdir(),
      `rstest-memory-limit-${process.pid}-${Date.now()}.log`,
    );
    onTestFinished(() => {
      if (existsSync(logPath)) unlinkSync(logPath);
    });

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, './fixtures'),
          env: {
            RSTEST_MEMLIMIT_LOG: logPath,
          },
        },
      },
    });
    await expectExecSuccess();

    // 4 files × `maxWorkers: 1` × `memoryLimit: 1` byte → every worker's
    // first reported RSS is over-limit, so the pool must dispose it
    // before the next task. Result: each file lands in a distinct
    // process.pid. If the cap was ignored (regression), all 4 lines
    // would share a pid and this assertion would catch it.
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(4);
    const pids = new Set(lines.map((line) => line.split('\t')[0]));
    expect(pids.size).toBe(4);
  });
});
