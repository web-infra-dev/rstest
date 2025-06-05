import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test setup file', async () => {
  it('should run setup file correctly', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout
      .split('\n')
      .filter((log) => log.startsWith('[afterAll]'));
    expect(cli.exec.process?.exitCode).toBe(0);
    expect(logs).toEqual(['[afterAll] setup']);
  });

  it('should test error when run setup file failed', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/error'),
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);
    // test error log
    expect(logs.find((log) => log.includes('Rstest setup error'))).toBeTruthy();
    expect(
      logs.find((log) => log.includes('rstest.setup.ts:1:7')),
    ).toBeTruthy();
  });
});
