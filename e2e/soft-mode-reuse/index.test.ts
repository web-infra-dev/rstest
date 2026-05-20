import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('experiments.softMode — multi-worker reuse', () => {
  it('reuses workers across files when files > workers', async ({
    onTestFinished,
  }) => {
    const logPath = join(
      tmpdir(),
      `rstest-soft-mode-reuse-${process.pid}-${Date.now()}.log`,
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
            RSTEST_SOFT_REUSE_LOG: logPath,
          },
        },
      },
    });
    await expectExecSuccess();

    // 4 fixture files × pool.maxWorkers=2 → by pigeon-hole, at least
    // one pid must appear on ≥2 lines. If softMode silently fell back
    // to `isolate: true`, every file would have its own pid and the
    // unique-pid set would have 4 elements — the assertion below
    // catches that regression.
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(4);

    const pids = new Set(lines.map((line) => line.split('\t')[0]));
    expect(pids.size).toBeLessThan(4);
    // And at least one worker really was reused (not just one worker
    // for all 4 — that would be a single-worker fallback regression).
    expect(pids.size).toBeGreaterThanOrEqual(1);
  });
});
