import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

const expectCoverageSummary = (logs: string[]) => {
  const isCommonJs = process.env.RSTEST_OUTPUT_MODULE === 'false';

  expect(
    logs
      .find((log) => log.includes('string.ts') && log.includes('|'))
      ?.replaceAll(' ', ''),
  ).toBe(
    isCommonJs
      ? 'string.ts|75|50|66.66|71.42|7-12'
      : 'string.ts|75|50|66.66|78.57|2-3,7',
  );

  expect(
    logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
  ).toBe(
    isCommonJs
      ? 'Allfiles|93.44|76.92|88.88|92.85|'
      : 'Allfiles|93.44|84.61|88.88|94.64|',
  );
};

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
    expectCoverageSummary(logs);

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

  it('keeps user source files under scoped @rstest folders', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'scoped-source'),
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
    ).toMatchInlineSnapshot(`"index.ts|100|100|100|100|"`);

    fs.removeSync(join(__dirname, 'scoped-source/coverage'));
  });

  it('matches project-relative coverage include in nested projects', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'multi-project'),
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
    ).toMatchInlineSnapshot(`"counter.ts|100|100|100|100|"`);

    fs.removeSync(join(__dirname, 'multi-project/coverage'));
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
    expectCoverageSummary(logs);

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
