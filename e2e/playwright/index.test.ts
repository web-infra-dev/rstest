import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const canRunHeadedPlaywrightTests =
  process.platform === 'darwin' ||
  process.platform === 'win32' ||
  (process.platform === 'linux' &&
    Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

const shouldRunHeadedPlaywrightTests =
  canRunHeadedPlaywrightTests &&
  Boolean(process.env.CI || process.env.RSTEST_E2E_RUN_HEADED);

describe('@rstest/playwright', () => {
  it('runs with Playwright fixtures and assertions', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts', 'debug.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            RSTEST_PLAYWRIGHT_TRACE: 'off',
          },
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_E2E_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_NAMED_FIXTURE_CLEANUP_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_FILE_FIXTURE_CLEANUP_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_DEBUG_OFF');
    expect(cli.stdout).toContain('Test Files 2 passed');
  });

  it('only resolves directly destructured test.for fixtures', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--pool.maxWorkers=1',
        'for-fixtures.test.ts',
        'config-second.test.ts',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_FOR_FIXTURES_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_CONFIG_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_CONFIG_SECOND_FILE_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_RUNTIME_EXTEND_OK');
  });

  it('preserves Playwright assertion errors at the timeout deadline', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'expect-timeout.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();
    expect(cli.stdout).toContain('Expected locator to be visible.');
    expect(cli.stdout).not.toContain(
      'Playwright assertion timed out after 0ms.',
    );
  });

  it('reuses and cleans up a browser across worker files', async () => {
    const cleanupMarker = join(
      __dirname,
      'fixtures',
      'browser-reuse-cleanup.txt',
    );
    await rm(cleanupMarker, { force: true });

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--globals',
        '--pool.maxWorkers=1',
        'browser-reuse-a.test.ts',
        'browser-reuse-b.test.ts',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_CROSS_FILE_FIRST_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_CROSS_FILE_REUSE_OK');
    expect(cli.stdout).toContain('Test Files 2 passed');
    await expect(readFile(cleanupMarker, 'utf8')).resolves.toBe(
      'RSTEST_PLAYWRIGHT_CROSS_FILE_CLEANUP_OK',
    );
    await rm(cleanupMarker, { force: true });
  });

  it('writes Playwright trace debug artifacts', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace.test.ts', '--hookTimeout', '1'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_RETRY_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_FIRST_RETRY_OK');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_ALL_RETRIES_OK');
    expect(cli.stdout).toContain('[rstest-playwright] Trace saved:');
  });

  it('can enable Playwright trace from env', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace-env.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            RSTEST_PLAYWRIGHT_TRACE: 'on-first-retry',
            RSTEST_PLAYWRIGHT_TRACE_OUTPUT_DIR: '.rstest-env-traces',
          },
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_ENV_OK');
    expect(cli.stdout).toContain('[rstest-playwright] Trace saved:');
  });

  it('lets Playwright trace fixture config override env', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace-env-priority.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            RSTEST_PLAYWRIGHT_TRACE: 'on',
            RSTEST_PLAYWRIGHT_TRACE_OUTPUT_DIR: '.rstest-env-priority-traces',
          },
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_PRIORITY_OK');
    expect(cli.stdout).not.toContain('[rstest-playwright] Trace saved:');
  });

  it('retains Playwright trace when onTestFinished fails', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace-on-finished-failure.test.ts', '--hookTimeout', '1'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_ON_FINISHED_FAIL_OK');
  });

  it('retains Playwright trace when later fixture teardown fails', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace-teardown-failure.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_TRACE_TEARDOWN_FAIL_OK');
  });

  it('finalizes Playwright trace when context close fails', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace-context-close-failure.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    expect(cli.stdout).toContain(
      'RSTEST_PLAYWRIGHT_TRACE_CONTEXT_CLOSE_FAIL_OK',
    );
  });

  it('keeps Playwright resources alive for failure diagnostics', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'failure-diagnostics.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_FAILURE_DIAGNOSTICS_OK');
  });

  it('cleans up request and serve fixtures after another fixture fails', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'cleanup-failure.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();
    expect(cli.log).toContain('user cleanup failed');
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_CLEANUP_OK');
  });

  it('reports extended hook fixtures missing from base tests', async () => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'hook-fixture-mismatch.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('Hook has unknown fixture "customValue"');
    expect(output).not.toContain('Playwright hook received a missing fixture');
  });

  it('does not write retained traces for passing tests', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'trace-retain-pass.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_RETAIN_PASS_OK');
    expect(cli.stdout).not.toContain('[rstest-playwright] Trace saved:');
  });

  it.skipIf(!shouldRunHeadedPlaywrightTests)(
    'can opt into headed debug mode from a test',
    { timeout: 60_000 },
    async () => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', 'debug.test.ts'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures'),
            env: {
              RSTEST_PLAYWRIGHT_E2E_DEBUG: 'true',
            },
          },
        },
      });

      await expectExecSuccess();
      expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_DEBUG_ON');
    },
  );
});
