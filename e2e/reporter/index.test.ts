import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { parseMarkerPayload, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parseReporterMetadata = (stdout: string) =>
  parseMarkerPayload<Record<string, any>>(
    stdout,
    '__RSTEST_REPORTER_METADATA__',
  );

describe.concurrent('reporters', () => {
  it('default - single file', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/index.test.ts', '--exclude', 'ansi/**'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('✗ basic > b');
    // should show all test cases when running a single test file
    expect(cli.stdout).toContain('- basic > c');
  });

  it('default - multiple files', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
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
      args: ['run', 'fixtures/index.test.ts', '--reporters=verbose'],
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

  it('dot', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/index.test.ts', '--reporters=dot'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('·x-');
    expect(cli.stdout).toContain('1 failed');
    expect(cli.stdout).toContain('1 passed');
    expect(cli.stdout).toContain('1 skipped');
  });

  it('default - silent passed-only, including concurrent tasks and multiple failures sharing logs', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/silent.test.ts',
        'fixtures/silentConcurrent.test.ts',
        'fixtures/silentMultipleFailures.test.ts',
        '--silent=passed-only',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();
    // Log blocks from different files interleave, so key each check on the
    // `log | <file> > <task>` header.
    const fileLog = 'log | fixtures/silent.test.ts\nfile level log';
    const suiteLog =
      'log | fixtures/silent.test.ts > failing suite\nfailing suite log';
    const caseLog =
      'log | fixtures/silent.test.ts > failing suite > failing case\nfailing case log';
    expect(cli.stdout, 'silent fixture reported as failing').toMatch(
      /✗ fixtures\/silent\.test\.ts/,
    );
    expect(cli.stdout).toContain(fileLog);
    expect(cli.stdout).toContain(suiteLog);
    expect(cli.stdout).toContain(caseLog);
    expect(cli.stdout.indexOf(fileLog)).toBeLessThan(
      cli.stdout.indexOf(suiteLog),
    );
    expect(cli.stdout.indexOf(suiteLog)).toBeLessThan(
      cli.stdout.indexOf(caseLog),
    );
    expect(cli.stdout).not.toContain('passing suite log');
    expect(cli.stdout).not.toContain('passing case log');

    expect(cli.stdout, 'silentConcurrent fixture reported as failing').toMatch(
      /✗ fixtures\/silentConcurrent\.test\.ts/,
    );
    expect(
      cli.stdout,
      'concurrent failing case log is attributed to the failing case',
    ).toContain(
      'log | fixtures/silentConcurrent.test.ts > failing concurrent case\nfailing concurrent case log',
    );
    expect(
      cli.stdout,
      'concurrent passing case log is suppressed',
    ).not.toContain('passing concurrent case log');

    expect(
      cli.stdout,
      'silentMultipleFailures fixture reported as failing',
    ).toMatch(/✗ fixtures\/silentMultipleFailures\.test\.ts/);
    expect(
      cli.stdout.match(/shared file log/g)?.length,
      'shared file log printed once across multiple failures',
    ).toBe(1);
    expect(
      cli.stdout.match(/shared suite log/g)?.length,
      'shared suite log printed once across multiple failures',
    ).toBe(1);
    expect(cli.stdout, 'first failing case log printed').toContain(
      'log | fixtures/silentMultipleFailures.test.ts > shared failing suite > first failing case\nfirst failing case log',
    );
    expect(cli.stdout, 'second failing case log printed').toContain(
      'log | fixtures/silentMultipleFailures.test.ts > shared failing suite > second failing case\nsecond failing case log',
    );
  });

  it('default - each project uses its own silent config', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'fixtures/silentProjects.config.mts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('[silent-a]');
    expect(cli.stdout).toContain('[loud-b]');
    expect(cli.stdout).not.toContain('console from silent-a');
    expect(cli.stdout).toContain('console from loud-b');
  });

  it('dot - silent passed-only', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/silent.test.ts',
        '--reporters=dot',
        '--silent=passed-only',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('file level log');
    expect(cli.stdout).toContain('failing suite log');
    expect(cli.stdout).toContain('failing case log');
    expect(cli.stdout).not.toContain('passing suite log');
    expect(cli.stdout).not.toContain('passing case log');
  });

  it('default - silent passed-only should still work when console intercept is disabled', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/silent.test.ts',
        '--silent=passed-only',
        '--disableConsoleIntercept',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('file level log');
    expect(cli.stdout).toContain('failing suite log');
    expect(cli.stdout).toContain('failing case log');
    expect(cli.stdout).not.toContain('passing suite log');
    expect(cli.stdout).not.toContain('passing case log');
  });

  it('default - silent passed-only should ignore onConsoleLog when console intercept is disabled', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/silent.test.ts',
        '--silent=passed-only',
        '--disableConsoleIntercept',
        '-c',
        'fixtures/silentOnConsoleLogFalse.config.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('file level log');
    expect(cli.stdout).toContain('failing suite log');
    expect(cli.stdout).toContain('failing case log');
  });

  it('hideSkippedTests', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/index.test.ts',
        '--reporters=verbose',
        '--hideSkippedTests',
      ],
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

  it('hideSkippedTestFiles', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--hideSkippedTestFiles'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    expect(cli.stdout).toContain('index.test.ts');
    expect(cli.stdout).not.toContain('allSkipped.test.ts');
  });

  it('custom', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/index.test.ts',
        '-c',
        './rstest.customReporterConfig.ts',
      ],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;

    expect(cli.stdout).toContain('[custom reporter] onTestSuiteStart');
    expect(
      cli.stdout.match(/\[custom reporter\] onTestSuiteStart/g)?.length,
    ).toBe(1);

    expect(cli.stdout).toContain('[custom reporter] onTestSuiteResult');
    expect(
      cli.stdout.match(/\[custom reporter\] onTestSuiteResult/g)?.length,
    ).toBe(1);

    expect(cli.stdout).toContain('[custom reporter] onTestCaseStart');
    expect(
      cli.stdout.match(/\[custom reporter\] onTestCaseStart/g)?.length,
    ).toBe(3);

    expect(cli.stdout).toContain('[custom reporter] onTestFileStart');
    expect(cli.stdout).toContain('[custom reporter] onTestFileReady');

    expect(
      cli.stdout.match(/\[custom reporter\] onTestCaseResult/g)?.length,
    ).toBe(3);

    expect(
      cli.stdout.match(/\[custom reporter\] onTestRunStart/g)?.length,
    ).toBe(1);
    expect(cli.stdout.match(/\[custom reporter\] onTestRunEnd/g)?.length).toBe(
      1,
    );
  });

  it('exposes metadata to custom reporter hooks', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', './rstest.metadataReporterConfig.ts'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const result = parseReporterMetadata(cli.stdout);

    expect(result.caseStartMeta).toEqual([
      {
        name: 'inherits metadata',
        meta: { fromSuite: true, shared: 'suite' },
      },
      {
        name: 'skipped metadata',
        meta: { fromSuite: true, shared: 'skip', skippedCase: true },
      },
      {
        name: 'todo metadata',
        meta: { fromSuite: true, shared: 'todo', todoCase: true },
      },
      {
        name: 'overrides metadata',
        meta: { fromSuite: true, shared: 'case', caseOnly: true },
      },
    ]);
    expect(result.caseResultMeta).toEqual([
      {
        name: 'inherits metadata',
        meta: { fromSuite: true, shared: 'suite', runtime: 'first' },
      },
      {
        name: 'skipped metadata',
        meta: { fromSuite: true, shared: 'skip', skippedCase: true },
      },
      {
        name: 'todo metadata',
        meta: { fromSuite: true, shared: 'todo', todoCase: true },
      },
      {
        name: 'overrides metadata',
        meta: {
          fromSuite: true,
          shared: 'case',
          caseOnly: true,
          runtime: 'second',
          replaced: true,
          afterEach: true,
        },
      },
    ]);
    expect(result.suiteResultMeta).toEqual([
      { fromSuite: true, shared: 'suite', suiteHook: 'afterAll' },
    ]);
    expect(result.fileResultMeta).toEqual({ fileHook: 'afterAll' });
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
