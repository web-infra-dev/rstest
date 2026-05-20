import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('experiments.softMode — maxFilesPerWorker recycle', () => {
  it('disposes the runner after each task when maxFilesPerWorker=1', async ({
    onTestFinished,
  }) => {
    const logPath = join(
      tmpdir(),
      `rstest-soft-mode-recycle-${process.pid}-${Date.now()}.log`,
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
            RSTEST_SOFT_RECYCLE_LOG: logPath,
          },
        },
      },
    });
    await expectExecSuccess();

    // 4 fixture files × maxFilesPerWorker=1 → every runner is disposed
    // after a single task, so every file MUST observe a unique pid. If
    // recycling were broken (cap ignored or off-by-one), some pair of
    // files would share a pid and this assertion would catch it.
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(4);

    const pids = new Set(lines.map((line) => line.split('\t')[0]));
    expect(pids.size).toBe(4);
  });
});
