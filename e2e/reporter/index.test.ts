import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPORTER_METADATA_RE = /__RSTEST_REPORTER_METADATA__(.*?)__END__/;

const parseReporterMetadata = (stdout: string) => {
  const match = stdout.match(REPORTER_METADATA_RE);
  const payload = match?.[1];
  if (!payload) {
    throw new Error(
      `reporter metadata payload not found in stdout. Got:\n${stdout.slice(
        0,
        4000,
      )}`,
    );
  }
  return JSON.parse(payload) as Record<string, any>;
};

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

  it('default - silent passed-only', async ({ onTestFinished }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/silent.test.ts', '--silent=passed-only'],
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
    expect(cli.stdout.indexOf('file level log')).toBeLessThan(
      cli.stdout.indexOf('failing suite log'),
    );
    expect(cli.stdout.indexOf('failing suite log')).toBeLessThan(
      cli.stdout.indexOf('failing case log'),
    );
    expect(cli.stdout).not.toContain('passing suite log');
    expect(cli.stdout).not.toContain('passing case log');
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

  it('default - silent passed-only should keep concurrent task logs associated to the failing case', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/silentConcurrent.test.ts',
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
    expect(cli.stdout).toContain('failing concurrent case log');
    expect(cli.stdout).not.toContain('passing concurrent case log');
  });

  it('default - silent passed-only should only print shared file and suite logs once across multiple failures', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
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
    expect(cli.stdout.match(/shared file log/g)?.length).toBe(1);
    expect(cli.stdout.match(/shared suite log/g)?.length).toBe(1);
    expect(cli.stdout).toContain('first failing case log');
    expect(cli.stdout).toContain('second failing case log');
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

    expect(cli.stdout).toContain('[custom reporter] onTestRunStart');
    expect(cli.stdout).toContain('[custom reporter] onTestRunEnd');
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
