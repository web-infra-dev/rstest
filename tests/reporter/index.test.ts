import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('reporters', () => {
  it('default', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('✓ basic > a');
    expect(cli.stdout).toContain('✗ basic > b');
  });

  it('custom', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.customReporterConfig.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('[custom reporter] onTestFileStart');
    expect(
      cli.stdout.match(/\[custom reporter\] onTestCaseResult/g)?.length,
    ).toBe(2);
    expect(cli.stdout).toContain('[custom reporter] onTestRunEnd');
  });

  it('empty', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.emptyReporterConfig.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).not.toContain('✓ basic > a');
    expect(cli.stdout).not.toContain('✗ basic > b');
  });
});
