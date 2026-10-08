import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const fixtureDir = join(__dirname, 'fixtures');

describe.skipIf(process.platform === 'win32')('worker SIGKILL recovery', () => {
  it.for([false, true])(
    'forks (always killed: %s)',
    async (alwaysKill, { onTestFinished }) => {
      const dir = mkdtempSync(join(tmpdir(), 'rstest-kill-'));
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const attempts = join(dir, 'attempts');
      const { cli, expectExecSuccess, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          'worker.kill',
          'node.warning',
          '--pool.maxWorkers',
          '2',
          '--reporter',
          'default',
        ],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: fixtureDir,
            env: {
              RSTEST_KILL_ATTEMPTS: attempts,
              RSTEST_ALWAYS_KILL: String(alwaysKill),
            },
          },
        },
      });
      if (alwaysKill) await expectExecFailed();
      else await expectExecSuccess();
      expect(readFileSync(attempts, 'utf8').trim().split('\n')).toHaveLength(
        alwaysKill ? 3 : 2,
      );
      expect(cli.log).toContain(
        'attempt 1/3; re-running with concurrency ceiling',
      );
      if (alwaysKill) {
        expect(cli.log).toContain(
          'SIGKILL even when running alone after 3 attempts',
        );
        expect(cli.log).toMatch(/Tests\s+1 failed.*1 passed/);
        // The final error is a worker crash, not an rstest code frame.
        expect(cli.log).not.toContain('dist/');
      } else {
        expect(cli.log).toMatch(/Tests\s+2 passed/);
      }
    },
  );
});

it.runIf(process.platform === 'linux')(
  'prefers fork workers as OOM victims',
  async ({ onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'worker.oomScore.test.ts', '--pool.type', 'forks'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixtureDir } },
    });
    await expectExecSuccess();
  },
);
