import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe.concurrent('test exit code', () => {
  it('should return code 0 when test succeed', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('should return code 1 when test failed', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fail.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
  });

  it('should return code 1 and print error correctly when test config error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'fixtures/error.config.ts'],
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
      logs.find((log) => log.includes('Invalid pool configuration')),
    ).toBeDefined();
  });
});
