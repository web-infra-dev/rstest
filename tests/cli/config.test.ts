import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test config load', () => {
  it('should throw error when custom test config not found', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'a.config.ts'],
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
      logs.find((log) => log.includes('Cannot find config file')),
    ).toBeDefined();
  });

  it('should throw error when plugin setup error', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'success.test.ts', '-c', 'fixtures/plugin.error.config.ts'],
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
      logs.find((log) => log.includes('plugin setup error')),
    ).toBeDefined();
  });

  it('should throw error when plugin setup error in watch mode', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'watch',
        'success.test.ts',
        '-c',
        'fixtures/plugin.error.config.ts',
      ],
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
      logs.find((log) => log.includes('plugin setup error')),
    ).toBeDefined();
  });
});
