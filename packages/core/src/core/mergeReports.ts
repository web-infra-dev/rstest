import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'pathe';
import { createCoverageProvider } from '../coverage';
import type { BlobData } from '../reporter/blob';
import type {
  Duration,
  SnapshotSummary,
  TestFileCoverageResult,
  TestFileResult,
  TestResult,
} from '../types';
import { color, logger, prettyTime } from '../utils';
import type { Rstest } from './rstest';

const DEFAULT_BLOB_DIR = '.rstest-reports';

function loadBlobFiles(blobDir: string): BlobData[] {
  if (!existsSync(blobDir)) {
    throw new Error(
      `Blob reports directory not found: ${color.cyan(blobDir)}\n` +
        'Run tests with --reporter=blob first to generate shard reports.',
    );
  }

  const files = readdirSync(blobDir)
    .filter((f) => /^blob(-\d+-\d+)?\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No blob report files found in: ${color.cyan(blobDir)}\n` +
        'Run tests with --reporter=blob first to generate shard reports.',
    );
  }

  return files.map((file) => {
    const content = readFileSync(join(blobDir, file), 'utf-8');
    return JSON.parse(content) as BlobData;
  });
}

function mergeSnapshots(summaries: SnapshotSummary[]): SnapshotSummary {
  const merged: SnapshotSummary = {
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
  };

  for (const s of summaries) {
    merged.added += s.added;
    merged.filesAdded += s.filesAdded;
    merged.filesRemoved += s.filesRemoved;
    merged.filesRemovedList.push(...s.filesRemovedList);
    merged.filesUnmatched += s.filesUnmatched;
    merged.filesUpdated += s.filesUpdated;
    merged.matched += s.matched;
    merged.total += s.total;
    merged.unchecked += s.unchecked;
    merged.uncheckedKeysByFile.push(...s.uncheckedKeysByFile);
    merged.unmatched += s.unmatched;
    merged.updated += s.updated;
    if (s.didUpdate) {
      merged.didUpdate = true;
    }
    if (s.failure) {
      merged.failure = true;
    }
  }

  return merged;
}

function mergeDurations(durations: Duration[]): Duration {
  let totalTime = 0;
  let buildTime = 0;
  let testTime = 0;

  for (const d of durations) {
    totalTime += d.totalTime;
    buildTime += d.buildTime;
    testTime += d.testTime;
  }

  return { totalTime, buildTime, testTime };
}

export async function mergeReports(
  context: Rstest,
  options?: {
    path?: string;
    cleanup?: boolean;
  },
): Promise<void> {
  const { path, cleanup } = options || {};
  const blobDir = path
    ? join(context.rootPath, path)
    : join(context.rootPath, DEFAULT_BLOB_DIR);

  const blobs = loadBlobFiles(blobDir);

  const relativeBlobDir = relative(context.rootPath, blobDir) || '.';
  logger.log(
    `\nMerging ${color.bold(String(blobs.length))} blob ${blobs.length === 1 ? 'report' : 'reports'} from ${color.cyan(relativeBlobDir)}\n`,
  );

  const allResults: TestFileResult[] = [];
  const allCoverageResults: TestFileCoverageResult[] = [];
  const allTestResults: TestResult[] = [];
  const allDurations: Duration[] = [];
  const shardDurations: { label: string; duration: Duration }[] = [];
  const allSnapshotSummaries: SnapshotSummary[] = [];
  const allUnhandledErrors: Error[] = [];

  for (const blob of blobs) {
    allResults.push(...blob.results);
    allCoverageResults.push(...(blob.coverageResults || blob.results));
    allTestResults.push(...blob.testResults);
    allDurations.push(blob.duration);
    allSnapshotSummaries.push(blob.snapshotSummary);

    const shardLabel = blob.shard
      ? `Shard ${blob.shard.index}/${blob.shard.count}`
      : 'Shard';
    shardDurations.push({ label: shardLabel, duration: blob.duration });

    if (blob.unhandledErrors) {
      for (const e of blob.unhandledErrors) {
        const error = new Error(e.message);
        error.name = e.name || 'Error';
        error.stack = e.stack;
        allUnhandledErrors.push(error);
      }
    }

    if (blob.consoleLogs) {
      for (const log of blob.consoleLogs) {
        for (const reporter of context.reporters) {
          reporter.onUserConsoleLog?.(log);
        }
      }
    }
  }

  const mergedDuration = mergeDurations(allDurations);
  const mergedSnapshotSummary = mergeSnapshots(allSnapshotSummaries);

  const hasFailure =
    allResults.some((r) => r.status === 'fail') ||
    allUnhandledErrors.length > 0;

  if (hasFailure) {
    process.exitCode = 1;
  }

  const testPaths = Array.from(
    new Set(allResults.map((result) => result.testPath)),
  );

  for (const reporter of context.reporters) {
    await reporter.onTestRunStart?.({
      testPaths,
      runKind: 'full',
    });
  }

  // Print per-shard durations
  for (const { label, duration } of shardDurations) {
    logger.log(
      color.gray(
        `  ${label}: ${prettyTime(duration.totalTime)} (build ${prettyTime(duration.buildTime)}, tests ${prettyTime(duration.testTime)})`,
      ),
    );
  }
  if (shardDurations.length > 0) {
    logger.log('');
  }

  for (const result of allResults) {
    for (const reporter of context.reporters) {
      reporter.onTestFileResult?.(result);
    }
  }

  for (const reporter of context.reporters) {
    await reporter.onTestRunEnd?.({
      results: allResults,
      testResults: allTestResults,
      duration: mergedDuration,
      snapshotSummary: mergedSnapshotSummary,
      unhandledErrors: allUnhandledErrors.length
        ? allUnhandledErrors
        : undefined,
      getSourcemap: async () => null,
      reason:
        allResults.length === 0 && allTestResults.length === 0
          ? 'no-tests'
          : hasFailure
            ? 'failed'
            : 'passed',
      runKind: 'full',
    });
  }

  const { coverage } = context.normalizedConfig;
  if (coverage.enabled && (!hasFailure || coverage.reportOnFailure)) {
    const coverageProvider = await createCoverageProvider(
      coverage,
      context.rootPath,
    );

    if (coverageProvider) {
      const { generateCoverage } = await import('../coverage/generate');
      await generateCoverage(context, allCoverageResults, coverageProvider);
    }
  }

  if (cleanup && existsSync(blobDir)) {
    rmSync(blobDir, { recursive: true });
    logger.log(
      color.gray(`Cleaned up blob reports directory: ${relativeBlobDir}\n`),
    );
  }
}
