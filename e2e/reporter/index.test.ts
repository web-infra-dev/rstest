import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe.concurrent('reporters', () => {
  it('default', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('✗ basic > b');
    expect(cli.stdout).not.toContain('- basic > c');
  });

  it('verbose', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '--reporter=verbose'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('✓ basic > a');
    expect(cli.stdout).toContain('- basic > c');
  });

  it('hideSkippedTests', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '--reporter=verbose', '--hideSkippedTests'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('✓ basic > a');
    expect(cli.stdout).not.toContain('- basic > c');
  });

  it('custom', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '-c', './rstest.customReporterConfig.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('[custom reporter] onTestCaseStart');
    expect(
      cli.stdout.match(/\[custom reporter\] onTestCaseStart/g)?.length,
    ).toBe(3);
    expect(cli.stdout).toContain('[custom reporter] onTestFileStart');

    expect(
      cli.stdout.match(/\[custom reporter\] onTestCaseResult/g)?.length,
    ).toBe(3);
    expect(cli.stdout).toContain('[custom reporter] onTestRunEnd');
  });

  it('empty', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '-c', './rstest.emptyReporterConfig.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).not.toContain('✗ basic > b');
  });

  it('logHeapUsage', async ({ onTestFinished }) => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index', '--logHeapUsage'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expectLog(/fixtures\/index.test.ts.*\d+ MB heap used/);
    expectLog(/✗ basic > b.*\d+ MB heap used/);
  });
});
