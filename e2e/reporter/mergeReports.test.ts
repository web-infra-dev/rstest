import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, 'fixtures-merge');
const replayFixturesDir = join(__dirname, 'fixtures-replay');

describe('merge-reports', () => {
  it('should generate blob reports and merge them', async () => {
    // Clean up any leftover blob reports
    const blobDir = join(fixturesDir, '.rstest-reports');
    if (existsSync(blobDir)) {
      fs.removeSync(blobDir);
    }

    // Run shard 1/2 with blob reporter
    const { expectExecSuccess: shard1Success } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--shard', '1/2', '--reporters=blob'],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await shard1Success();

    // Verify blob file was created
    expect(
      existsSync(join(fixturesDir, '.rstest-reports', 'blob-1-2.json')),
    ).toBe(true);

    // Run shard 2/2 with blob reporter
    const { expectExecSuccess: shard2Success } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--shard', '2/2', '--reporters=blob'],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await shard2Success();

    // Verify both blob files exist
    expect(
      existsSync(join(fixturesDir, '.rstest-reports', 'blob-2-2.json')),
    ).toBe(true);

    // Run merge-reports with --cleanup to remove blob dir
    const { cli, expectExecSuccess: mergeSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['merge-reports', '--cleanup'],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await mergeSuccess();

    const logs = cli.stdout;

    // Should display merged results
    expect(logs).toContain('Merging 2 blob reports from');
    expect(logs).toContain('Tests 4 passed');
    expect(logs).toContain('Test Files 2 passed');

    // Blob directory should be cleaned up after merge
    expect(existsSync(join(fixturesDir, '.rstest-reports'))).toBe(false);
  });

  it('should merge coverage reports from multiple shards', async () => {
    const coverageDir = join(fixturesDir, 'coverage');
    const blobDir = join(fixturesDir, '.rstest-reports');
    // Clean up before test
    if (existsSync(coverageDir)) {
      fs.removeSync(coverageDir);
    }
    if (existsSync(blobDir)) {
      fs.removeSync(blobDir);
    }

    // Run shard 1/2 with blob reporter + coverage
    const { expectExecSuccess: shard1Success } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--shard',
        '1/2',
        '--reporters=blob',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await shard1Success();

    const shard1Blob = JSON.parse(
      readFileSync(join(blobDir, 'blob-1-2.json'), 'utf-8'),
    ) as { coverage?: Record<string, unknown>; coverageResults?: unknown[] };
    expect(shard1Blob.coverage).toBeTruthy();
    expect(shard1Blob.coverageResults).toBeUndefined();

    // Run shard 2/2 with blob reporter + coverage
    const { expectExecSuccess: shard2Success } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--shard',
        '2/2',
        '--reporters=blob',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await shard2Success();

    // Run merge-reports with coverage enabled
    const { cli: mergeCli, expectExecSuccess: mergeSuccess } =
      await runRstestCli({
        command: 'rstest',
        args: [
          'merge-reports',
          '--cleanup',
          '-c',
          'rstest.coverage.config.mts',
        ],
        options: {
          nodeOptions: {
            cwd: fixturesDir,
          },
        },
      });
    await mergeSuccess();

    const coverageLogs = mergeCli.stdout;

    // Should display merged results
    expect(coverageLogs).toContain('Merging 2 blob reports from');

    // Should display coverage table
    expect(coverageLogs).toContain('% Stmts');
    expect(coverageLogs).toContain('math.ts');

    // Coverage directory should be generated
    expect(existsSync(coverageDir)).toBe(true);

    // Clean up
    fs.removeSync(coverageDir);
  });

  it('should generate V8 coverage for untested files when merging reports', async () => {
    const coverageDir = join(fixturesDir, 'coverage');
    const blobDir = join(fixturesDir, '.rstest-reports');
    fs.removeSync(coverageDir);
    fs.removeSync(blobDir);

    for (const shard of ['1/2', '2/2']) {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--shard',
          shard,
          '--reporters=blob',
          '-c',
          'rstest.coverage-v8.config.mts',
        ],
        options: {
          nodeOptions: {
            cwd: fixturesDir,
          },
        },
      });
      await expectExecSuccess();
    }

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        '--cleanup',
        '-c',
        'rstest.coverage-v8.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await expectExecSuccess();

    const coverageSummary = fs.readJsonSync(
      join(coverageDir, 'coverage-summary.json'),
    ) as Record<string, Record<string, { total: number; covered: number }>>;
    expect(
      coverageSummary[join(fixturesDir, 'v8-src/types-only.ts')],
    ).toMatchObject({
      lines: { total: 0, covered: 0 },
      statements: { total: 0, covered: 0 },
      functions: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
    });
    expect(
      coverageSummary[join(fixturesDir, 'v8-src/untested.ts')],
    ).toMatchObject({
      lines: { total: 1, covered: 0 },
      statements: { total: 1, covered: 0 },
      functions: { total: 1, covered: 0 },
      branches: { total: 0, covered: 0 },
    });

    fs.removeSync(coverageDir);
  });
});

describe('merge-reports lifecycle replay', () => {
  const blobDir = join(replayFixturesDir, '.rstest-reports');

  const runReplayFixture = async (args: string[], expectFailure = false) => {
    const { cli, expectExecSuccess, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args,
      options: { nodeOptions: { cwd: replayFixturesDir } },
    });
    await (expectFailure ? expectExecFailed() : expectExecSuccess());
    return cli.stdout;
  };

  /** Drops the `testId` field so an expectation can be written literally. */
  const withoutTestIds = (events: string[]): string[] =>
    events.map((event) => {
      const [hook, _testId, ...rest] = event.split(' | ');
      return [hook, ...rest].join(' | ');
    });

  const parseLifecycle = (stdout: string): string[] => {
    const match = stdout.match(/__RSTEST_LIFECYCLE__(.*)__END__/s);
    if (!match) {
      throw new Error(`No lifecycle events recorded in:\n${stdout}`);
    }
    return JSON.parse(match[1]!) as string[];
  };

  it('replays every reporter hook a live run fires', async () => {
    fs.removeSync(blobDir);

    const liveEvents = parseLifecycle(await runReplayFixture(['run']));
    await runReplayFixture(['run', '--reporters=blob']);
    const mergedEvents = parseLifecycle(
      await runReplayFixture(['merge-reports', '--cleanup']),
    );

    // Every hook the fixture can exercise must show up in the live baseline,
    // otherwise the comparison below would pass on an empty sequence.
    expect(new Set(liveEvents.map((event) => event.split(' | ')[0]))).toEqual(
      new Set([
        'onTestRunStart',
        'onTestFileStart',
        'onTestFileReady',
        'onTestSuiteStart',
        'onTestSuiteResult',
        'onTestCaseStart',
        'onTestCaseResult',
        'onTestFileResult',
        'onUserConsoleLog',
        'onTestRunEnd',
      ]),
    );

    expect(mergedEvents).toEqual(liveEvents);
  });

  it('replays a bail-elided run exactly as the live run reported it', async () => {
    fs.removeSync(blobDir);
    const config = ['-c', 'rstest.bail.config.mts'];

    const liveEvents = parseLifecycle(
      await runReplayFixture(['run', ...config], true),
    );
    await runReplayFixture(['run', ...config, '--reporters=blob'], true);
    const mergedEvents = parseLifecycle(
      await runReplayFixture(['merge-reports', '--cleanup', ...config], true),
    );

    // The live runner returns from a bail-elided task before either of its
    // hooks fires, so nothing after the failure is reported — not the sibling
    // case, not the suites that would have held the rest. `2 roots` shows the
    // collected tree still carries those nodes, so replay only stays faithful
    // by skipping the ones with no recorded result. Test ids are dropped: they
    // hash the absolute test path, which differs per checkout.
    expect(withoutTestIds(liveEvents)).toEqual([
      'onTestRunStart',
      'onTestFileStart',
      'onTestFileReady | 2 roots',
      'onTestSuiteStart | bail outer',
      'onTestCaseStart | failing case',
      'onTestCaseResult | failing case | fail',
      'onTestSuiteResult | bail outer | fail',
      'onTestFileResult | fail',
      'onTestRunEnd',
    ]);

    expect(mergedEvents).toEqual(liveEvents);
  });

  it('refuses to merge blob reports from another Rstest version', async () => {
    // The gate rejects before any payload is read, so a hand-written stub is
    // enough — no need to spend a fixture run producing a real blob.
    fs.outputFileSync(
      join(blobDir, 'blob.json'),
      JSON.stringify({ version: '0.0.0-other' }),
    );

    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['merge-reports'],
      options: { nodeOptions: { cwd: replayFixturesDir } },
    });
    await expectExecFailed();
    expectStderrLog(
      /blob\.json was generated by Rstest 0\.0\.0-other, but this is Rstest/,
    );

    fs.removeSync(blobDir);
  });
});
