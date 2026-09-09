import {
  existsSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import {
  getCoverageSummaryEntry,
  parseMarkerPayload,
  runRstestCli,
} from '../scripts';

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

    expect(existsSync(coverageDir)).toBe(false);

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

    expect(existsSync(coverageDir)).toBe(false);

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

  it('preserves blob inputs when coverage reports contain them', async () => {
    const blobDir = join(fixturesDir, '.rstest-reports');
    const reportsDir = join(fixturesDir, 'coverage-merge-input');
    fs.removeSync(blobDir);
    fs.removeSync(reportsDir);

    for (const shard of ['1/2', '2/2']) {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--shard',
          shard,
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
      await expectExecSuccess();
    }

    const mergedBlobDir = join(reportsDir, 'blobs');
    fs.ensureDirSync(reportsDir);
    renameSync(blobDir, mergedBlobDir);

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        'coverage-merge-input/blobs',
        '--coverage.reportsDirectory=coverage-merge-input',
        '--coverage.reporters=json-summary',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await expectExecSuccess();

    expect(existsSync(join(mergedBlobDir, 'blob-1-2.json'))).toBe(true);
    expect(existsSync(join(mergedBlobDir, 'blob-2-2.json'))).toBe(true);
    expect(existsSync(join(reportsDir, 'coverage-summary.json'))).toBe(true);

    fs.removeSync(reportsDir);
  });

  it('cleans co-located reports without deleting inputs or final output', async () => {
    const blobDir = join(fixturesDir, '.rstest-reports');
    const nestedReportsDir = join(blobDir, 'coverage');
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
          'rstest.coverage.config.mts',
        ],
        options: {
          nodeOptions: {
            cwd: fixturesDir,
          },
        },
      });
      await expectExecSuccess();
    }

    writeFileSync(join(blobDir, 'stale-report.txt'), 'stale');

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        '--coverage.reportsDirectory=.rstest-reports',
        '--coverage.reporters=json-summary',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await expectExecSuccess();

    expect(existsSync(join(blobDir, 'blob-1-2.json'))).toBe(true);
    expect(existsSync(join(blobDir, 'blob-2-2.json'))).toBe(true);
    expect(existsSync(join(blobDir, 'stale-report.txt'))).toBe(false);
    expect(existsSync(join(blobDir, 'coverage-summary.json'))).toBe(true);

    const { expectExecSuccess: cleanupSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        '--cleanup',
        '--coverage.reportsDirectory=.rstest-reports/coverage',
        '--coverage.reporters=json-summary',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await cleanupSuccess();

    expect(existsSync(join(blobDir, 'blob-1-2.json'))).toBe(false);
    expect(existsSync(join(blobDir, 'blob-2-2.json'))).toBe(false);
    expect(existsSync(join(nestedReportsDir, 'coverage-summary.json'))).toBe(
      true,
    );

    fs.removeSync(blobDir);
  });

  it('does not follow a symlinked blob directory during coverage cleanup', async () => {
    const blobDir = join(fixturesDir, '.rstest-reports');
    const artifactDir = join(fixturesDir, 'coverage-artifact-target');
    fs.removeSync(blobDir);
    fs.removeSync(artifactDir);

    for (const shard of ['1/2', '2/2']) {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--shard',
          shard,
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
      await expectExecSuccess();
    }

    renameSync(blobDir, artifactDir);
    symlinkSync(artifactDir, blobDir, 'junction');
    writeFileSync(join(artifactDir, 'keep.txt'), 'keep');

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        '--coverage.reportsDirectory=.rstest-reports',
        '--coverage.reporters=json-summary',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await expectExecSuccess();

    expect(existsSync(join(artifactDir, 'keep.txt'))).toBe(true);
    expect(existsSync(join(artifactDir, 'blob-1-2.json'))).toBe(true);
    expect(existsSync(join(artifactDir, 'blob-2-2.json'))).toBe(true);
    expect(existsSync(join(artifactDir, 'coverage-summary.json'))).toBe(true);

    const { expectExecSuccess: cleanupSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        '--cleanup',
        '--coverage.reportsDirectory=.rstest-reports/coverage',
        '--coverage.reporters=json-summary',
        '-c',
        'rstest.coverage.config.mts',
      ],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
        },
      },
    });
    await cleanupSuccess();

    expect(existsSync(blobDir)).toBe(false);
    expect(existsSync(join(artifactDir, 'keep.txt'))).toBe(true);
    expect(existsSync(join(artifactDir, 'blob-1-2.json'))).toBe(true);
    expect(existsSync(join(artifactDir, 'blob-2-2.json'))).toBe(true);
    expect(
      existsSync(join(artifactDir, 'coverage', 'coverage-summary.json')),
    ).toBe(true);

    fs.removeSync(blobDir);
    fs.removeSync(artifactDir);
  });

  it('finalizes Istanbul coverage only when merging blob reports', async () => {
    const coverageDir = join(fixturesDir, 'coverage-istanbul-cli');
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
          '--coverage.include=src/**',
          '--coverage.include=istanbul-src/**',
          '-c',
          'rstest.coverage-istanbul.config.mts',
        ],
        options: {
          nodeOptions: {
            cwd: fixturesDir,
          },
        },
      });
      await expectExecSuccess();
      expect(existsSync(coverageDir)).toBe(false);
    }

    const shardCoverage = fs.readJsonSync(join(blobDir, 'blob-1-2.json'))
      .coverage as Record<string, unknown>;
    expect(Object.keys(shardCoverage)).not.toContain(
      join(fixturesDir, 'istanbul-src/untested.ts'),
    );
    expect(Object.keys(shardCoverage)).not.toContain(
      join(fixturesDir, 'istanbul-src/untested.jsx'),
    );

    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'merge-reports',
        '--cleanup',
        '--coverage.include=src/**',
        '--coverage.include=istanbul-src/**',
        '--coverage.reporters=json-summary',
        '--coverage.reportsDirectory=coverage-istanbul-cli',
        '-c',
        'rstest.coverage-istanbul.config.mts',
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
    for (const file of ['decorators.js', 'untested.ts', 'untested.jsx']) {
      expect(
        getCoverageSummaryEntry(
          coverageSummary,
          join(fixturesDir, 'istanbul-src', file),
        ),
      ).toMatchObject({
        lines: { covered: 0 },
        statements: { covered: 0 },
        functions: { covered: 0 },
        branches: { covered: 0 },
      });
    }

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
      getCoverageSummaryEntry(
        coverageSummary,
        join(fixturesDir, 'v8-src/types-only.ts'),
      ),
    ).toMatchObject({
      lines: { total: 0, covered: 0 },
      statements: { total: 0, covered: 0 },
      functions: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
    });
    expect(
      getCoverageSummaryEntry(
        coverageSummary,
        join(fixturesDir, 'v8-src/untested.ts'),
      ),
    ).toMatchObject({
      lines: { total: 1, covered: 0 },
      statements: { total: 2, covered: 0 },
      functions: { total: 1, covered: 0 },
      branches: { total: 0, covered: 0 },
    });
    expect(
      getCoverageSummaryEntry(
        coverageSummary,
        join(fixturesDir, 'v8-src/decorators.js'),
      ),
    ).toMatchObject({
      lines: { covered: 0 },
      statements: { covered: 0 },
      functions: { covered: 0 },
      branches: { covered: 0 },
    });

    fs.removeSync(coverageDir);
  });
});

describe('merge-reports lifecycle replay', () => {
  const blobDir = join(replayFixturesDir, '.rstest-reports');

  const runFixture = (args: string[]) =>
    runRstestCli({
      command: 'rstest',
      args,
      options: { nodeOptions: { cwd: replayFixturesDir } },
    });

  const parseLifecycle = (stdout: string): string[] =>
    parseMarkerPayload<string[]>(stdout, '__RSTEST_LIFECYCLE__');

  /**
   * Records one fixture run live and replays that same run's blob, so the two
   * event sequences can be compared. Every fixture config carries both the
   * recorder and the blob reporter for that reason: a baseline recorded from a
   * separate run would be a different run's order, which for the concurrent
   * fixture is a different interleaving.
   *
   * `expectFailure` covers fixtures that end non-zero, and is threaded through
   * both runs — a run whose exit code goes unasserted would hide a broken
   * fixture.
   */
  const captureReplay = async (config: string[], expectFailure = false) => {
    fs.removeSync(blobDir);
    const run = async (args: string[]) => {
      const { cli, expectExecSuccess, expectExecFailed } = await runFixture([
        ...args,
        ...config,
      ]);
      await (expectFailure ? expectExecFailed() : expectExecSuccess());
      return cli.stdout;
    };

    const live = parseLifecycle(await run(['run']));
    const merged = parseLifecycle(await run(['merge-reports', '--cleanup']));
    return { live, merged };
  };

  it('replays every reporter hook a live run fires, in live order', async () => {
    const { live: liveEvents, merged: mergedEvents } = await captureReplay([]);

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

    const names = liveEvents.map((event) =>
      event.split(' | ').slice(2).join(' | '),
    );
    // Orderings a depth-first tree walk cannot represent: both cases start
    // before either reports, and the faster one reports first.
    expect(names.filter((n) => n.startsWith('concurrent'))).toEqual([
      expect.stringMatching(/^concurrent slow \| startTime=/),
      expect.stringMatching(/^concurrent fast \| startTime=/),
      'concurrent fast | pass',
      'concurrent slow | pass',
    ]);
    // `afterAll` output carries the suite's task id but is written after the
    // child results, so it cannot be flushed at suite start.
    expect(names.indexOf('afterAll log')).toBeGreaterThan(
      names.indexOf('concurrent slow | pass'),
    );

    expect(mergedEvents).toEqual(liveEvents);
  });

  it('replays bail elision and a bail-skipped file as the live run reported them', async () => {
    const { live: liveEvents, merged: mergedEvents } = await captureReplay(
      ['-c', 'rstest.bail.config.mts'],
      true,
    );

    // The collected tree still carries every node bail elided — both root
    // suites reach `onTestFileReady` — so the blob replays them back.
    expect(liveEvents).toContainEqual(
      expect.stringMatching(/^onTestFileReady \| .* \| 2 roots$/),
    );
    // Yet the live runner returns from an elided task before either of its
    // hooks fires, so nothing named `elided` is ever reported. That is the
    // property replay must reproduce: a node with no recorded result is
    // skipped, not resurrected from the tree.
    expect(liveEvents.filter((event) => event.includes('elided'))).toEqual([]);
    expect(
      liveEvents.filter((event) => event.includes('failing case')),
    ).toHaveLength(2);

    // The same failure trips the worker's cross-file bail check: the skipped
    // file's result returns before its `onTestFileStart` would fire, so it
    // reports a result and nothing else — replay must not invent the missing
    // file window.
    const skipped = liveEvents.filter((event) => event.includes('bailSecond'));
    expect(skipped).toEqual([
      expect.stringMatching(/^onTestFileResult \| .* \| skip$/),
    ]);

    expect(mergedEvents).toEqual(liveEvents);
  });

  it('replays a file with no tests, including its file window', async () => {
    // A test-less file fails the run ("No test found") but still fires
    // file-start/ready/result and its module-level log. The tree is empty, so
    // the blob cannot derive the owning project from it — this is the case
    // that forces every payload to carry `project` explicitly.
    const { live: liveEvents, merged: mergedEvents } = await captureReplay(
      ['-c', 'rstest.empty.config.mts'],
      true,
    );

    expect(liveEvents).toContainEqual(
      expect.stringMatching(/^onTestFileReady \| .* \| 0 roots$/),
    );
    expect(liveEvents).toContainEqual(
      expect.stringContaining('module-level log from a file with no tests'),
    );

    expect(mergedEvents).toEqual(liveEvents);
  });

  it('replays a track that has no file result, minus the result hook', async () => {
    // A browser client that goes fatal after file-start records events but
    // never produces a `TestFileResult` (the error outcome carries empty
    // results). Hand-write that blob shape: the version must match, and no
    // fixture run can produce it without a real browser crash.
    const { createRequire } = await import('node:module');
    const { version } = createRequire(import.meta.url)(
      '@rstest/core/package.json',
    ) as { version: string };

    const testPath = join(replayFixturesDir, 'fatal.test.ts');
    fs.removeSync(blobDir);
    fs.outputFileSync(
      join(blobDir, 'blob.json'),
      JSON.stringify({
        version,
        results: [],
        testResults: [],
        // The real fatal outcome always carries the error here — it is what
        // makes the merge exit non-zero, since no failed result exists.
        unhandledErrors: [{ message: 'fatal: setup exploded', name: 'Error' }],
        duration: { totalTime: 1, buildTime: 1, testTime: 0 },
        snapshotSummary: {
          added: 0,
          didUpdate: false,
          failure: false,
          filesAdded: 0,
          filesRemoved: 0,
          filesRemovedList: [],
          filesUnmatched: 0,
          filesUpdated: 0,
          matched: 0,
          total: 0,
          unchecked: 0,
          uncheckedKeysByFile: [],
          unmatched: 0,
          updated: 0,
        },
        files: {
          [JSON.stringify(['rstest', testPath])]: {
            events: [
              {
                h: 'start',
                test: {
                  testId: `file:${testPath}`,
                  testPath,
                  project: 'rstest',
                  tests: [],
                },
              },
              {
                h: 'log',
                log: {
                  content: 'log before the fatal',
                  name: 'log',
                  testPath,
                  project: 'rstest',
                  type: 'stdout',
                },
              },
            ],
          },
        },
      }),
    );

    const { cli, expectExecFailed } = await runFixture([
      'merge-reports',
      '--cleanup',
    ]);
    await expectExecFailed();

    expect(parseLifecycle(cli.stdout)).toEqual([
      'onTestRunStart',
      expect.stringMatching(/^onTestFileStart \| .*fatal\.test\.ts$/),
      expect.stringContaining('log before the fatal'),
      'onTestRunEnd',
    ]);
  });

  it('rejects the blob reporter in watch mode', async () => {
    // Blob reports feed the one-shot merge workflow; recording across watch
    // reruns has no coherent semantics, so the reporter is rejected outright.
    const { expectExecFailed, expectStderrLog } = await runFixture(['watch']);
    await expectExecFailed();
    expectStderrLog(/Blob reporter is not supported in watch mode/);
  });

  it('refuses to merge blob reports from another Rstest version', async () => {
    // The gate rejects before any payload is read, so a hand-written stub is
    // enough — no need to spend a fixture run producing a real blob.
    fs.outputFileSync(
      join(blobDir, 'blob.json'),
      JSON.stringify({ version: '0.0.0-other' }),
    );

    const { expectExecFailed, expectStderrLog } = await runFixture([
      'merge-reports',
    ]);
    await expectExecFailed();
    expectStderrLog(
      /blob\.json was generated by Rstest 0\.0\.0-other, but this is Rstest/,
    );

    fs.removeSync(blobDir);
  });
});
