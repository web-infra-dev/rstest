import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

describe('test coverage-v8', () => {
  it('coverage-v8', async () => {
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

    expectLog('Coverage enabled with v8', logs);

    // test coverage
    expect(
      logs.find(
        (log) =>
          log.includes('index.test.ts') &&
          log.includes('|') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeFalsy();

    expect(
      logs.find(
        (log) =>
          log.includes('rstest.setup.ts') &&
          log.includes('|') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeFalsy();

    expect(
      logs.find(
        (log) =>
          log.includes('index.ts') &&
          log.includes('|') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeTruthy();
    expect(
      logs
        .find((log) => log.includes('string.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"string.ts|80|100|60|80|2-4,7-8"`);

    expect(
      logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"Allfiles|98.46|100|87.5|98.46|"`);

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

    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });

  it('enable coverage with `--coverage`', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage', '-c', 'rstest.enable.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with v8', logs);
    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });

  it('coverage-v8 with custom options', async () => {
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

    expectLog('Coverage enabled with v8', logs);

    // test coverage
    expect(
      logs.find((log) => log.includes('index.ts') && log.includes('|')),
    ).toBeFalsy();
    expect(
      logs
        .find((log) => log.includes('string.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"string.ts|80|100|60|80|2-4,7-8"`);

    // text reporter
    expectLog('% Stmts', logs);

    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
    ).toBeFalsy();
    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });

  it('coverage-v8 with custom reportsDirectory', async () => {
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

    expectLog('Coverage enabled with v8', logs);

    expect(
      fs.existsSync(join(__dirname, 'fixtures/test-temp-coverage/index.html')),
    ).toBeTruthy();
    fs.removeSync(join(__dirname, 'fixtures/test-temp-coverage'));
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

    expectLog('Coverage enabled with v8', logs);

    // When no files match the coverage include patterns, all coverage should be 0
    expect(
      logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"Allfiles|0|0|0|0|"`);
    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });
});
