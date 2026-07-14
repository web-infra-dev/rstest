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
    expect(cli.stdout).toContain('RSTEST_PLAYWRIGHT_DEBUG_OFF');
    expect(cli.stdout).toContain('Test Files 2 passed');
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
            RSTEST_PLAYWRIGHT_TRACE: 'on',
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
