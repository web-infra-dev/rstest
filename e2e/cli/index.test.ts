import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe.concurrent('test exit code', () => {
  it('should return code 0 when test succeed', async ({ onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should return code 1 when test failed', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fail.test.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
  });

  it('should return code 1 when cli options error', async ({
    onTestFinished,
  }) => {
    const { expectStderrLog, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-a', 'success.test.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();
    expectStderrLog(/Unknown option `-a`/);
  });

  it('should support --pool shorthand', async ({ onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '--pool', 'forks'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should return code 1 and print error correctly when test config error', async ({
    onTestFinished,
  }) => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'fixtures/error.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog(/Invalid pool configuration/);
  });

  it('should get RSTEST flag correctly in config', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'fixtures/flag.config.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('load config success')),
    ).toBeDefined();
  });
});
