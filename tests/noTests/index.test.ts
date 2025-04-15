import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('no tests', () => {
  it('should error when no tests', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/'],
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
      logs.find((log) => log.includes('Test Files 2 failed')),
    ).toBeDefined();
    expect(logs.find((log) => log.includes('Tests no tests'))).toBeDefined();
  });

  it('should passWithNoTests with passWithNoTests flag', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/', '--passWithNoTests'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(0);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 2 passed')),
    ).toBeDefined();
    expect(logs.find((log) => log.includes('Tests no tests'))).toBeDefined();
  });
});
