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
      ? 'string.ts|81.25|50|66.66|78.57|3-6,10'
      : 'string.ts|75|50|66.66|78.57|2-3,7',
  );

  expect(
    logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
  ).toBe(
    isCommonJs
      ? 'Allfiles|95.08|76.92|88.88|94.64|'
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

  it('overrides coverage reports directory from CLI', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.enable.config.ts',
        '--coverage.reporters',
        'json',
        '--coverage.reportsDirectory',
        'cli-coverage',
      ],
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
      fs.existsSync(
        join(__dirname, 'fixtures/cli-coverage/coverage-final.json'),
      ),
    ).toBeTruthy();
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/coverage-final.json')),
    ).toBeFalsy();

    fs.removeSync(join(__dirname, 'fixtures/cli-coverage'));
  });

  it('overrides coverage include and exclude from CLI', async () => {
    const ignoredNodeModule = join(
      __dirname,
      'fixtures/node_modules/ignored-package/index.ts',
    );
    fs.outputFileSync(
      ignoredNodeModule,
      'export const ignored = () => "ignored";\n',
    );

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.enable.config.ts',
        '--coverage.reporters',
        'text',
        '--coverage.include',
        'src/**',
        '--coverage.exclude',
        '**/date.ts',
      ],
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
      logs.find((log) => log.includes('index.ts') && log.includes('|')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('date.ts') && log.includes('|')),
    ).toBeFalsy();
    expect(
      logs.find((log) => log.includes('ignored-package') && log.includes('|')),
    ).toBeFalsy();

    fs.removeSync(join(__dirname, 'fixtures/node_modules/ignored-package'));
    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });

  it('overrides coverage clean from CLI', async () => {
    const staleCoverageFile = join(
      __dirname,
      'fixtures/coverage/stale-coverage.json',
    );
    fs.ensureFileSync(staleCoverageFile);

    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.enable.config.ts',
        '--coverage.reporters',
        'json',
        '--coverage.clean=false',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with v8', logs);
    expect(fs.existsSync(staleCoverageFile)).toBeTruthy();
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/coverage-final.json')),
    ).toBeTruthy();

    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });

  it('overrides coverage reporters from CLI', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        'rstest.enable.config.ts',
        '--coverage.reporters',
        'text',
        '--coverage.reporters=json',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Coverage enabled with v8', logs);
    expectLog('% Stmts', logs);
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/coverage-final.json')),
    ).toBeTruthy();
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
    ).toBeFalsy();
    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/clover.xml')),
    ).toBeFalsy();

    fs.removeSync(join(__dirname, 'fixtures/coverage'));
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
