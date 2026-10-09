import fs from 'node:fs';
import { join } from 'node:path';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const githubWorkspace = __dirname;

const expectWorkspacePath = (stepSummary: string) => {
  expect(stepSummary).toContain('> Under path: `<ROOT>`');
};

it.skipIf(!process.env.CI)(
  'github-actions skips summary rendering when GITHUB_STEP_SUMMARY is unset',
  async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'githubActions', '--reporters', 'github-actions'],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            GITHUB_WORKSPACE: githubWorkspace,
            GITHUB_STEP_SUMMARY: undefined,
          },
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout
      .split('\n')
      .filter(Boolean)
      .filter((log) => log.startsWith('::error'));

    expect(logs).toHaveLength(2);
    expect(cli.stdout).not.toContain('Failed to write GitHub step summary');
  },
);

it.skipIf(!process.env.CI)(
  'github-actions summary on pass and on failure',
  async () => {
    const stepSummaryPath = join(__dirname, '.tmp', 'github-step-summary.md');
    fs.rmSync(stepSummaryPath, { force: true });

    // Launch 1: passing run.
    const passingRun = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        './rstest.agentMd.pass.config.mts',
        '--reporters',
        'github-actions',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            GITHUB_WORKSPACE: githubWorkspace,
            GITHUB_STEP_SUMMARY: stepSummaryPath,
          },
        },
      },
    });

    await passingRun.cli.exec;
    await passingRun.cli.waitForStreamsEnd();
    expect(passingRun.cli.exec.process?.exitCode).toBe(0);

    const passLogs = passingRun.cli.stdout
      .split('\n')
      .filter(Boolean)
      .filter((log) => log.startsWith('::error'));

    expect(passLogs).toEqual([]);
    expect(fs.existsSync(stepSummaryPath)).toBe(true);

    const passSummary = fs
      .readFileSync(stepSummaryPath, 'utf-8')
      .replaceAll(process.cwd(), '<ROOT>');

    expect(passSummary).toContain('<details>');
    expect(passSummary).not.toContain('<details open>');
    expect(passSummary).toContain('<summary>Rstest Test Reporter ✅</summary>');
    expect(passSummary).toContain('# Rstest Test Reporter ✅');
    expectWorkspacePath(passSummary);
    expect(passSummary).toContain('## Summary');
    expect(passSummary).toContain('| **Test Files** | ✅ 2 passed |');
    expect(passSummary).toContain(
      '| **Tests** | ✅ 13 passed \\| 1 skipped (14) |',
    );
    expect(passSummary).toMatch(
      /\| \*\*Duration\*\* \| .+ \(build .+, tests .+\) \|/,
    );
    expect(passSummary).not.toContain('## Failures');

    // Launch 2: failing run, appended to the same step summary file.
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'githubActions', '--reporters', 'github-actions'],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            GITHUB_WORKSPACE: githubWorkspace,
            GITHUB_STEP_SUMMARY: stepSummaryPath,
          },
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout
      .replaceAll(process.cwd(), '<ROOT>')
      .split('\n')
      .filter(Boolean)
      .filter((log) => log.startsWith('::error'));

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(
      /^::error file=<ROOT>[\\/]reporter[\\/]fixtures[\\/]githubActions\.test\.ts,line=4,col=17,title=fixtures\/githubActions\.test\.ts > should add two numbers correctly::expected 2 to be 4 \/\/ Object\.is equality%0A- Expected%0A\+ Received%0A%0A- 4%0A\+ 2$/,
    );
    expect(logs[1]).toContain(
      'title=fixtures/githubActions.test.ts > test snapshot::Snapshot `test snapshot 1` mismatched%0A- Expected%0A+ Received%0A%0A- "hello world"%0A+ "hello"',
    );

    const stepSummary = fs
      .readFileSync(stepSummaryPath, 'utf-8')
      .replaceAll(process.cwd(), '<ROOT>');

    // Both runs are grouped in one file as collapsible sections.
    expect(
      stepSummary,
      'grouped summary keeps the passing run section',
    ).toContain('<summary>Rstest Test Reporter ✅</summary>');
    expect(
      stepSummary,
      'grouped summary appends the failing run section',
    ).toContain('<summary>Rstest Test Reporter ❌</summary>');
    expect(
      stepSummary.match(/<details>/g)?.length,
      'passing run section stays collapsed in the grouped summary',
    ).toBeGreaterThanOrEqual(2);
    expect(
      stepSummary.match(/<details open>/g)?.length,
      'only the failing run section is expanded',
    ).toBe(1);

    // The failing run's section starts at its `<details open>`. Assert on it
    // alone so generic lines cannot be satisfied by the passing section.
    const failSummary = stepSummary.slice(
      stepSummary.indexOf('<details open>'),
    );
    expect(failSummary).not.toContain('Rstest Test Reporter ✅');
    expect(failSummary).toContain('<summary>Rstest Test Reporter ❌</summary>');
    expect(failSummary).toContain('# Rstest Test Reporter ❌');
    expectWorkspacePath(failSummary);
    expect(failSummary).toContain('## Summary');
    expect(failSummary).toContain('| **Test Files** | ❌ 1 failed |');
    expect(failSummary).toContain('| **Tests** | ❌ 2 failed |');
    expect(failSummary).toMatch(
      /\| \*\*Duration\*\* \| .+ \(build .+, tests .+\) \|/,
    );
    expect(failSummary).toContain('## Failures');
    expect(failSummary).toContain(
      '### ❌ FAIL fixtures/githubActions.test.ts > should add two numbers correctly',
    );
    expect(failSummary).toContain(
      '**AssertionError**: expected 2 to be 4 // Object.is equality',
    );
    expect(failSummary).toContain('- Expected');
    expect(failSummary).toContain('+ Received');
    expect(failSummary).toContain('- 4');
    expect(failSummary).toContain('+ 2');
    expect(failSummary).toMatch(/at fixtures\/githubActions\.test\.ts:\d+:\d+/);
    expect(failSummary).toContain(
      "pnpm exec rstest 'fixtures/githubActions.test.ts' --testNamePattern 'should add two numbers correctly'",
    );
    expect(failSummary).toContain(
      '### ❌ FAIL fixtures/githubActions.test.ts > test snapshot',
    );
    expect(failSummary).toContain(
      '**SnapshotMismatchError**: Snapshot `test snapshot 1` mismatched',
    );
    expect(failSummary).toContain(
      "pnpm exec rstest 'fixtures/githubActions.test.ts' --testNamePattern 'test snapshot'",
    );
    expect(failSummary).toContain('- "hello world"');
    expect(failSummary).toContain('+ "hello"');

    fs.rmSync(stepSummaryPath, { force: true });
    fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
  },
);

it.skipIf(!process.env.CI)(
  'github-actions summary includes flaky tests with previous failure summaries',
  async () => {
    const stepSummaryPath = join(
      __dirname,
      '.tmp',
      'github-step-summary-flaky.md',
    );
    fs.rmSync(stepSummaryPath, { force: true });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        './rstest.githubActions.flaky.config.mts',
        '--reporters',
        'github-actions',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            GITHUB_WORKSPACE: githubWorkspace,
            GITHUB_STEP_SUMMARY: stepSummaryPath,
          },
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.exec.process?.exitCode).toBe(0);

    const stepSummary = fs
      .readFileSync(stepSummaryPath, 'utf-8')
      .replaceAll(process.cwd(), '<ROOT>');

    expect(stepSummary).toContain('<details open>');
    expect(stepSummary).toContain('<summary>Rstest Test Reporter ⚠️</summary>');
    expect(stepSummary).toContain('# Rstest Test Reporter ⚠️');
    expectWorkspacePath(stepSummary);
    expect(stepSummary).toContain('| **Flaky Tests** | 1 passed after retry |');
    expect(stepSummary).toContain('## Flaky Tests');
    expect(stepSummary).toContain(
      '- `flaky-fixtures/githubActionsFlaky.test.ts > passes after retry` (passed after retry x1)',
    );
    expect(stepSummary).toContain(
      'Previous failure: AssertionError: expected 1 to be 2 // Object.is equality',
    );
    expect(stepSummary).not.toContain('## Failures');

    fs.rmSync(stepSummaryPath, { force: true });
    fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
  },
);

it.skipIf(!process.env.CI)(
  'github-actions summary includes explicit project name in title',
  async () => {
    const stepSummaryPath = join(
      __dirname,
      '.tmp',
      'github-step-summary-named-project.md',
    );
    fs.rmSync(stepSummaryPath, { force: true });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '-c',
        './rstest.githubActions.namedProject.config.mts',
        '--reporters',
        'github-actions',
      ],
      options: {
        nodeOptions: {
          cwd: __dirname,
          env: {
            GITHUB_WORKSPACE: githubWorkspace,
            GITHUB_STEP_SUMMARY: stepSummaryPath,
          },
        },
      },
    });

    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.exec.process?.exitCode).toBe(0);

    const stepSummary = fs
      .readFileSync(stepSummaryPath, 'utf-8')
      .replaceAll(process.cwd(), '<ROOT>');

    expect(stepSummary).toContain(
      '<summary>Rstest Test Reporter (named-project) ✅</summary>',
    );
    expect(stepSummary).toContain('# Rstest Test Reporter (named-project) ✅');

    fs.rmSync(stepSummaryPath, { force: true });
    fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
  },
);

it.skipIf(!process.env.CI)(
  'github-actions summary derives repro command from package manager',
  async () => {
    const stepSummaryPath = join(
      __dirname,
      '.tmp',
      'github-step-summary-npm.md',
    );
    const npmFixturePath = join(__dirname, 'fixtures-npm');

    fs.rmSync(stepSummaryPath, { force: true });

    try {
      const { cli } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--reporters', 'github-actions'],
        options: {
          nodeOptions: {
            cwd: npmFixturePath,
            env: {
              GITHUB_WORKSPACE: githubWorkspace,
              GITHUB_STEP_SUMMARY: stepSummaryPath,
            },
          },
        },
      });

      await cli.exec;
      await cli.waitForStreamsEnd();
      expect(cli.exec.process?.exitCode).toBe(1);

      const stepSummary = fs.readFileSync(stepSummaryPath, 'utf-8');

      expect(stepSummary).toContain(
        "npx rstest '../fixtures/githubActions.test.ts' --testNamePattern 'should add two numbers correctly'",
      );
    } finally {
      fs.rmSync(stepSummaryPath, { force: true });
      fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
    }
  },
);

it.skipIf(!process.env.CI)(
  'github-actions summary supports a custom field length',
  async () => {
    const stepSummaryPath = join(
      __dirname,
      '.tmp',
      'github-step-summary-long-diff.md',
    );
    fs.rmSync(stepSummaryPath, { force: true });

    try {
      const { cli } = await runRstestCli({
        command: 'rstest',
        args: ['run', '-c', './rstest.githubActions.longSummary.config.mts'],
        options: {
          nodeOptions: {
            cwd: __dirname,
            env: {
              GITHUB_WORKSPACE: githubWorkspace,
              GITHUB_STEP_SUMMARY: stepSummaryPath,
            },
          },
        },
      });

      await cli.exec;
      await cli.waitForStreamsEnd();
      expect(cli.exec.process?.exitCode).toBe(1);

      const stepSummary = fs.readFileSync(stepSummaryPath, 'utf-8');

      expect(stepSummary).toContain('-   "expected first line",');
      expect(stepSummary).toContain('+   "received last line",');
    } finally {
      fs.rmSync(stepSummaryPath, { force: true });
      fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
    }
  },
);
