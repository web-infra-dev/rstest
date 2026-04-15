import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, 'fixtures-merge');

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
      args: ['run', '--shard', '1/2', '--reporter=blob'],
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
      args: ['run', '--shard', '2/2', '--reporter=blob'],
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
        '--reporter=blob',
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
        '--reporter=blob',
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
});
