import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs, rstest } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test API', () => {
  it('test function undefined', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/undefined.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 1 failed')),
    ).toBeTruthy();
    expect(
      logs.find((log) =>
        log.includes('Tests 1 failed | 1 passed | 1 skipped | 1 todo'),
      ),
    ).toBeTruthy();
  });

  it('`rs` should be identical to `rstest`', () => {
    expect(rs).toBe(rstest);
  });

  it('context.skip skips the current test at runtime', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/contextSkip.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });
    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Tests 1 passed | 3 skipped')),
    ).toBeTruthy();
  });

  it('continues afterEach hooks after fixture setup fails', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fixtureSetupHookCleanup.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });
    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'later afterEach ran after test fixture failure',
    );
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'later afterEach ran after afterEach fixture failure',
    );
    expect(cli.stderr).toContain('test fixture setup failed');
    expect(cli.stderr).toContain('afterEach fixture setup failed');
    expect(cli.stderr).not.toContain('Circular fixture dependency');
  });

  it('reports named fixture cleanup failures', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/namedFixtureCleanupFailure.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'named fixture cleanup failed',
    );
  });

  it('bounds named fixture setup and cleanup with the test timeout', async () => {
    const start = Date.now();
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/namedFixtureCleanupTimeout.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'fixture setup timed out in 100ms',
    );
    expect(cli.stdout).toContain('RSTEST_NAMED_FIXTURE_SETUP_TIMEOUT_CLEANUP');
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'fixture cleanup timed out in 100ms',
    );
  });
});
