import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

describe('test coverage-istanbul', () => {
  it('coverage-istanbul', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.enable.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);

    // test coverage
    expect(
      logs.find(
        (log) =>
          log.includes('index.test.ts') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeFalsy();

    expect(
      logs.find(
        (log) =>
          log.includes('rstest.setup.ts') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeFalsy();

    expect(
      logs.find(
        (log) =>
          log.includes('index.ts') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('string.ts'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"string.ts|80.95|50|66.66|78.57|2-3,7"`);

    expect(
      logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"Allfiles|94.73|83.33|88.88|94.64|"`);

    // text reporter
    expectLog('% Stmts', logs);

    // html reporter
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
    ).toBeTruthy();

    // clover reporter
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/clover.xml')),
    ).toBeTruthy();

    // json reporter
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/coverage-final.json')),
    ).toBeTruthy();
  });

  it('enable coverage with `--coverage`', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);
  });

  it('should treat positional argument after `--coverage` as a file filter', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage', 'date'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);

    expectLog('Test Files 1 passed', logs);
  });

  it('should treat positional argument before `--coverage` as a file filter', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'date', '--coverage'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);
    expectLog('Test Files 1 passed', logs);
  });

  it('should switch coverage provider with `--coverage.provider v8`', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        '--coverage.provider',
        'v8',
        '--coverage.reportsDirectory',
        'cli-provider-v8-coverage',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, '../test-coverage-v8/fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with v8', logs);
    fs.removeSync(
      join(__dirname, '../test-coverage-v8/fixtures/cli-provider-v8-coverage'),
    );
  });

  it('should disable coverage with `--no-coverage`', async () => {
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--no-coverage'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.some((log) => log.includes('Coverage enabled with')),
    ).toBeFalsy();
  });

  it('coverage-istanbul with custom options', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.skipFull.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);

    // test coverage
    expect(logs.find((log) => log.includes('index.ts'))).toBeFalsy();
    expect(
      logs.find((log) => log.includes('string.ts'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"string.ts|80.95|50|66.66|78.57|2-3,7"`);

    // text reporter
    expectLog('% Stmts', logs);

    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
    ).toBeFalsy();
  });

  it('coverage-istanbul with custom reportsDirectory', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.reportsDirectory.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);

    expect(
      fs.existsSync(join(__dirname, 'fixtures/test-temp-coverage/index.html')),
    ).toBeTruthy();
  });

  it('coverage-istanbul with custom reporter', async () => {
    const reportFile = join(__dirname, 'fixtures/custom-coverage-report.json');
    fs.removeSync(reportFile);

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.customReporter.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);
    expect(fs.readJsonSync(reportFile)).toEqual({ lines: 94.64 });

    fs.removeSync(reportFile);
  });

  it('should keep coverage report when no test files match with --passWithNoTests (regression #1212)', async () => {
    const reportsDir = join(__dirname, 'fixtures/test-temp-no-tests-coverage');
    const staleFile = join(reportsDir, 'stale-from-previous-run.txt');

    fs.ensureDirSync(reportsDir);
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
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    expect(fs.existsSync(staleFile)).toBeFalsy();
    expect(fs.existsSync(join(reportsDir, 'index.html'))).toBeTruthy();

    fs.removeSync(reportsDir);
  });

  it('should show 0% coverage when no source files match coverage include patterns', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.noCoverageFiles.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with istanbul', logs);

    // When no files match the coverage include patterns, all coverage should be 0
    expect(
      logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"Allfiles|0|0|0|0|"`);
  });
});
