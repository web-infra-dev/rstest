import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

const fixturePath = join(__dirname, 'fixtures');

describe('coverage istanbul-specific behavior', () => {
  it('collects instrumented VM globals under vmThreads', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-istanbul-vm-threads';
    onTestFinished(() => fs.removeSync(join(fixturePath, reportsDirectory)));
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'src/index.test.ts',
        '-c',
        'rstest.enable.config.ts',
        '--pool',
        'vmThreads',
        '--pool.maxWorkers',
        '1',
        '--pool.memoryLimit',
        '256MB',
        '--coverage.reporters',
        'text-summary',
        '--coverage.reportsDirectory',
        reportsDirectory,
      ],
      options: { nodeOptions: { cwd: fixturePath } },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('Statements   : 100% ( 2/2 )');
  });

  it('enables the default provider with --coverage', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-istanbul-cli-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        '--coverage.reportsDirectory',
        reportsDirectory,
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();
    expectLog('Coverage enabled with istanbul', cli.stdout.split('\n'));
  });

  it('treats a positional argument after --coverage as a file filter', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-filter-after-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        'date',
        '--coverage.reportsDirectory',
        reportsDirectory,
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with istanbul', logs);
    expectLog('Test Files 1 passed', logs);
  });

  it('treats a positional argument before --coverage as a file filter', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-filter-before-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage.reportsDirectory',
        reportsDirectory,
        'date',
        '--coverage',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with istanbul', logs);
    expectLog('Test Files 1 passed', logs);
  });

  it('switches providers with --coverage.provider', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-cli-provider-v8-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        '--coverage.provider',
        'v8',
        '--coverage.reportsDirectory',
        reportsDirectory,
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();
    expectLog('Coverage enabled with v8', cli.stdout.split('\n'));
  });

  it('disables coverage with --no-coverage', async () => {
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--no-coverage'],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).not.toContain('Coverage enabled with');
  });

  it('supports custom coverage reporters', async ({ onTestFinished }) => {
    const reportFile = join(fixturePath, 'custom-coverage-report.json');
    const reportPath = join(fixturePath, 'test-temp-custom-reporter-coverage');
    onTestFinished(() => {
      fs.removeSync(reportFile);
      fs.removeSync(reportPath);
    });

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.customReporter.config.ts',
        '--coverage.reportsDirectory',
        'test-temp-custom-reporter-coverage',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    expectLog('Coverage enabled with istanbul', cli.stdout.split('\n'));
    expect(fs.readJsonSync(reportFile)).toEqual({ lines: 94.64 });
  });

  it('keeps coverage output when no tests match with --passWithNoTests', async ({
    onTestFinished,
  }) => {
    const reportPath = join(fixturePath, 'test-temp-no-tests-coverage');
    const staleFile = join(reportPath, 'stale-from-previous-run.txt');
    onTestFinished(() => fs.removeSync(reportPath));

    fs.ensureDirSync(reportPath);
    fs.writeFileSync(staleFile, 'stale');

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.noTests.config.ts',
        '--passWithNoTests',
        '--coverage',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    expect(fs.existsSync(staleFile)).toBeFalsy();
    expect(fs.existsSync(join(reportPath, 'index.html'))).toBeTruthy();
  });

  it('collects untested files when a project path contains a test directory', async ({
    onTestFinished,
  }) => {
    const packagePath = join(__dirname, 'test-dir-collision/packages/test');
    onTestFinished(() => fs.removeSync(join(packagePath, 'coverage')));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage'],
      options: {
        nodeOptions: {
          cwd: packagePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with istanbul', logs);
    expect(
      logs.find((log) => log.includes('untested.ts'))?.replaceAll(' ', ''),
    ).toBe('untested.ts|0|100|0|0|1');
  });
});
