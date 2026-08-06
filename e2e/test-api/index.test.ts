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

  it('shares file-scoped named fixtures and cleans them up after afterAll', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fileScopedNamedFixture.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecSuccess();
    const output = `${cli.stdout}\n${cli.stderr}`;
    const lifecycle = [
      'RSTEST_FILE_FIXTURE_BASE_SETUP',
      'RSTEST_FILE_FIXTURE_DERIVED_SETUP',
      'RSTEST_FILE_FIXTURE_AFTER_ALL',
      'RSTEST_FILE_FIXTURE_DERIVED_CLEANUP',
      'RSTEST_FILE_FIXTURE_BASE_CLEANUP',
    ];
    for (const event of lifecycle) {
      expect(output).toContain(event);
    }
    for (let index = 1; index < lifecycle.length; index++) {
      expect(output.indexOf(lifecycle[index]!)).toBeGreaterThan(
        output.indexOf(lifecycle[index - 1]!),
      );
    }
  });

  it('reports file-scoped named fixture cleanup failures', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fileScopedNamedFixtureCleanupFailure.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'file fixture cleanup failed',
    );
  });

  it('cleans ready file fixtures before unrelated setup settles', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fileScopedNamedFixtureCleanupProgress.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('fixture setup timed out in 50ms');
    expect(output.indexOf('RSTEST_READY_FILE_FIXTURE_CLEANUP')).toBeLessThan(
      output.indexOf('RSTEST_PENDING_FILE_FIXTURE_SETTLED'),
    );
  });

  it('rejects file-scoped named fixtures declared inside a suite', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fileScopedNamedFixtureNested.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'File-scoped fixtures must be defined at the top level of the test file.',
    );
  });

  it('rejects invalid named fixture names', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/namedFixtureInvalidName.test.ts'],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'Invalid named fixture name "base-url"',
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
    expect(cli.stdout).toContain('RSTEST_NAMED_FIXTURE_LATE_CLEANUP');
    expect(cli.stdout).toContain('RSTEST_NAMED_FIXTURE_LATE_CLEANUP_ORDER_OK');
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'fixture cleanup timed out in 100ms',
    );
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'RSTEST_NAMED_FIXTURE_LATE_CLEANUP_FAILED',
    );
  });

  it('preserves setup timeout when cancellation cleanup fails', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/namedFixtureCleanupTimeout.test.ts',
        '-t=preserves setup timeout when cancellation cleanup fails',
      ],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('fixture setup timed out in 100ms');
    expect(output).toContain('RSTEST_NAMED_FIXTURE_TIMEOUT_CLEANUP_FAILED');
  });
});
