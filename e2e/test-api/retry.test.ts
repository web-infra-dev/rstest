import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test Retry', () => {
  it('should run success with retry', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/retry.test.ts', '--retry=4'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();
  });

  it('should error when retry times exhausted', async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/retry.test.ts', '--retry=3'],
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
    expect(logs.find((log) => log.includes('Tests 1 failed'))).toBeTruthy();
  });
});
