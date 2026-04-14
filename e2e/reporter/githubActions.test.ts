import fs from 'node:fs';
import { join } from 'node:path';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it.skipIf(!process.env.CI)('github-actions', async () => {
  const stepSummaryPath = join(__dirname, '.tmp', 'github-step-summary.md');
  fs.rmSync(stepSummaryPath, { force: true });

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'githubActions', '--reporter', 'github-actions'],
    options: {
      nodeOptions: {
        cwd: __dirname,
        env: {
          GITHUB_STEP_SUMMARY: stepSummaryPath,
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

  expect(logs).toMatchInlineSnapshot(`
    [
      "::error file=<ROOT>/e2e/reporter/fixtures/githubActions.test.ts,line=4,col=17,title=fixtures/githubActions.test.ts > should add two numbers correctly::expected 2 to be 4 // Object.is equality%0A- Expected%0A+ Received%0A%0A- 4%0A+ 2",
      "::error file=<ROOT>/e2e/reporter/fixtures/githubActions.test.ts,line=8,col=19,title=fixtures/githubActions.test.ts > test snapshot::Snapshot \`test snapshot 1\` mismatched%0A- Expected%0A+ Received%0A%0A- "hello world"%0A+ "hello"",
    ]
  `);

  expect(fs.existsSync(stepSummaryPath)).toBe(true);
  const stepSummary = fs
    .readFileSync(stepSummaryPath, 'utf-8')
    .replaceAll(process.cwd(), '<ROOT>');
  expect(stepSummary).toContain('# Rstest Test Reporter');
  expect(stepSummary).toContain('> Under path: <ROOT>');
  expect(stepSummary).toContain('## Summary');
  expect(stepSummary).toContain('| **Test Files** | ❌ 1 failed |');
  expect(stepSummary).toContain('| **Tests** | ❌ 2 failed |');
  expect(stepSummary).toMatch(
    /\| \*\*Duration\*\* \| \d+ms \(build \d+ms, tests \d+ms\) \|/,
  );
  expect(stepSummary).toContain('## Failures');
  expect(stepSummary).toContain(
    '### ❌ FAIL fixtures/githubActions.test.ts > should add two numbers correctly',
  );
  expect(stepSummary).toContain(
    '**AssertionError**: expected 2 to be 4 // Object.is equality',
  );
  expect(stepSummary).toContain('- Expected');
  expect(stepSummary).toContain('+ Received');
  expect(stepSummary).toContain('- 4');
  expect(stepSummary).toContain('+ 2');
  expect(stepSummary).toMatch(/at fixtures\/githubActions\.test\.ts:\d+:\d+/);
  expect(stepSummary).toContain(
    "pnpm exec rstest 'fixtures/githubActions.test.ts' --testNamePattern 'should add two numbers correctly'",
  );
  expect(stepSummary).toContain(
    '### ❌ FAIL fixtures/githubActions.test.ts > test snapshot',
  );
  expect(stepSummary).toContain(
    '**SnapshotMismatchError**: Snapshot `test snapshot 1` mismatched',
  );
  expect(stepSummary).toContain(
    "pnpm exec rstest 'fixtures/githubActions.test.ts' --testNamePattern 'test snapshot'",
  );
  expect(stepSummary).toContain('- "hello world"');
  expect(stepSummary).toContain('+ "hello"');

  fs.rmSync(stepSummaryPath, { force: true });
  fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
});

it.skipIf(!process.env.CI)('github-actions summary on pass', async () => {
  const stepSummaryPath = join(
    __dirname,
    '.tmp',
    'github-step-summary-pass.md',
  );
  fs.rmSync(stepSummaryPath, { force: true });

  const { cli } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      '-c',
      './rstest.agentMd.pass.config.mts',
      '--reporter',
      'github-actions',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
        env: {
          GITHUB_STEP_SUMMARY: stepSummaryPath,
        },
      },
    },
  });

  await cli.exec;
  await cli.waitForStreamsEnd();
  expect(cli.exec.process?.exitCode).toBe(0);

  const logs = cli.stdout
    .split('\n')
    .filter(Boolean)
    .filter((log) => log.startsWith('::error'));

  expect(logs).toEqual([]);
  expect(fs.existsSync(stepSummaryPath)).toBe(true);

  const stepSummary = fs
    .readFileSync(stepSummaryPath, 'utf-8')
    .replaceAll(process.cwd(), '<ROOT>');

  expect(stepSummary).toContain('# Rstest Test Reporter');
  expect(stepSummary).toContain('> Under path: <ROOT>');
  expect(stepSummary).toContain('## Summary');
  expect(stepSummary).toContain('| **Test Files** | ✅ 2 passed |');
  expect(stepSummary).toContain(
    '| **Tests** | ✅ 13 passed | 1 skipped (14) |',
  );
  expect(stepSummary).toMatch(
    /\| \*\*Duration\*\* \| \d+ms \(build \d+ms, tests \d+ms\) \|/,
  );
  expect(stepSummary).not.toContain('## Failures');

  fs.rmSync(stepSummaryPath, { force: true });
  fs.rmSync(join(__dirname, '.tmp'), { recursive: true, force: true });
});
