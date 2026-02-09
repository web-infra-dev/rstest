import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, 'fixtures');

describe('test worker behavior', () => {
  it('should output node warnings correctly', async () => {
    const { expectExecSuccess, expectStderrLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'node.warning.test.ts'],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecSuccess();
    expectStderrLog(/MaxListenersExceededWarning/);
    // ExperimentalWarning should be suppressed
    expect(cli.log).not.toContain('ExperimentalWarning');
  });

  it('should include worker stderr in summary when worker exits unexpectedly', async () => {
    const marker = 'RSTEST_WORKER_PANIC_MARKER';
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'worker.panic.test.ts'],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecFailed();
    expect(cli.log).toContain('Worker exited unexpectedly');
    expect(cli.log).toContain('Maybe related stderr');
    expect(cli.log).toContain(marker);
  });
});
