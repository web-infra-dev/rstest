import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

const fixturePath = join(__dirname, 'fixtures');
const enableConfig = 'rstest.enable.v8.config.ts';

describe('coverage v8-specific behavior', () => {
  it('preserves the configured provider with --coverage', async ({
    onTestFinished,
  }) => {
    const reportsDirectory = 'test-temp-v8-cli-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--coverage',
        '-c',
        enableConfig,
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

  it('keeps user sources under scoped @rstest folders', async ({
    onTestFinished,
  }) => {
    const scopedFixturePath = join(__dirname, 'fixtures-v8/scoped-source');
    onTestFinished(() => fs.removeSync(join(scopedFixturePath, 'coverage')));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      options: {
        nodeOptions: {
          cwd: scopedFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expect(
      logs
        .find((log) => log.includes('index.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toBe('index.ts|100|100|100|100|');
  });

  it('matches project-relative include patterns in nested projects', async ({
    onTestFinished,
  }) => {
    const projectFixturePath = join(__dirname, 'fixtures-v8/multi-project');
    onTestFinished(() => fs.removeSync(join(projectFixturePath, 'coverage')));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      options: {
        nodeOptions: {
          cwd: projectFixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expect(
      logs
        .find((log) => log.includes('counter.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toBe('counter.ts|100|100|100|100|');
  });

  it('overrides the reports directory from CLI', async ({ onTestFinished }) => {
    const reportPath = join(fixturePath, 'cli-coverage');
    const defaultReportPath = join(fixturePath, 'coverage');
    onTestFinished(() => fs.removeSync(reportPath));
    fs.removeSync(defaultReportPath);

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'json',
        '--coverage.reportsDirectory',
        'cli-coverage',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    expectLog('Coverage enabled with v8', cli.stdout.split('\n'));
    expect(fs.existsSync(join(reportPath, 'coverage-final.json'))).toBeTruthy();
    expect(fs.existsSync(defaultReportPath)).toBeFalsy();
  });

  it('overrides include and exclude patterns from CLI', async ({
    onTestFinished,
  }) => {
    const ignoredPackagePath = join(
      fixturePath,
      'node_modules/ignored-package',
    );
    const reportsDirectory = 'test-temp-v8-include-exclude-coverage';
    const reportPath = join(fixturePath, reportsDirectory);
    onTestFinished(() => {
      fs.removeSync(ignoredPackagePath);
      fs.removeSync(reportPath);
    });

    fs.outputFileSync(
      join(ignoredPackagePath, 'index.ts'),
      'export const ignored = () => "ignored";\n',
    );

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'text',
        '--coverage.include',
        'src/**',
        '--coverage.exclude',
        '**/date.ts',
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
    expectLog('Coverage enabled with v8', logs);
    expect(
      logs.find((log) => log.includes('index.ts') && log.includes('|')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('date.ts') && log.includes('|')),
    ).toBeFalsy();
    expect(
      logs.find((log) => log.includes('ignored-package') && log.includes('|')),
    ).toBeFalsy();
  });

  it('overrides clean from CLI', async ({ onTestFinished }) => {
    const reportPath = join(fixturePath, 'coverage');
    const staleCoverageFile = join(reportPath, 'stale-coverage.json');
    onTestFinished(() => fs.removeSync(reportPath));
    fs.ensureFileSync(staleCoverageFile);

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'json',
        '--coverage.clean=false',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    expectLog('Coverage enabled with v8', cli.stdout.split('\n'));
    expect(fs.existsSync(staleCoverageFile)).toBeTruthy();
    expect(fs.existsSync(join(reportPath, 'coverage-final.json'))).toBeTruthy();
  });

  it('overrides reporters from CLI', async ({ onTestFinished }) => {
    const reportPath = join(fixturePath, 'coverage');
    onTestFinished(() => fs.removeSync(reportPath));

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        enableConfig,
        '--coverage.reporters',
        'text',
        '--coverage.reporters=json',
      ],
      options: {
        nodeOptions: {
          cwd: fixturePath,
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog('Coverage enabled with v8', logs);
    expectLog('% Stmts', logs);
    expect(fs.existsSync(join(reportPath, 'coverage-final.json'))).toBeTruthy();
    expect(fs.existsSync(join(reportPath, 'index.html'))).toBeFalsy();
    expect(fs.existsSync(join(reportPath, 'clover.xml'))).toBeFalsy();
  });
});
