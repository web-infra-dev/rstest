import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'pathe';
import {
  createCoverageProvider,
  ensureCoverageProviderInstalled,
} from '../coverage';
import {
  type BlobData,
  type BlobFileData,
  blobFileKey,
  isBlobFile,
  parseBlobFile,
} from '../reporter/blob';
import type {
  CoverageMapData,
  Duration,
  SnapshotSummary,
  TestFileResult,
  TestInfo,
  TestResult,
} from '../types';
import type { CoverageMap } from '../types/coverage';
import {
  color,
  flushOutputStreams,
  getFileTaskId,
  logger,
  prettyTime,
} from '../utils';
import type { Rstest } from './rstest';
import { createRunnerEventSink, type RunnerEventSink } from './runnerEventSink';

const DEFAULT_BLOB_DIR = '.rstest-reports';

function loadBlobFiles(blobDir: string): BlobData[] {
  if (!existsSync(blobDir)) {
    throw new Error(
      `Blob reports directory not found: ${color.cyan(blobDir)}\n` +
        'Run tests with --reporters=blob first to generate shard reports.',
    );
  }

  const files = readdirSync(blobDir).filter(isBlobFile).sort();

  if (files.length === 0) {
    throw new Error(
      `No blob report files found in: ${color.cyan(blobDir)}\n` +
        'Run tests with --reporters=blob first to generate shard reports.',
    );
  }

  return files.map((file) =>
    parseBlobFile(readFileSync(join(blobDir, file), 'utf-8'), file),
  );
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

/** One test file's recorded lifecycle, reassembled from a single blob. */
type ReplayFile = {
  result: TestFileResult;
  data: BlobFileData;
};

function indexTree(nodes: TestInfo[], into: Map<string, TestInfo>): void {
  for (const node of nodes) {
    into.set(node.testId, node);
    if (node.type === 'suite') {
      indexTree(node.tests, into);
    }
  }
}

/**
 * Replays one file's lifecycle through the live-run dispatch path, so a
 * reporter sees the same hook sequence it would see during a real run.
 *
 * The blob's event track is the authority for what fired and in what order;
 * walking the collected tree instead would invent an order (see
 * `BlobFileEvent`).
 */
async function replayTestFile(
  sink: RunnerEventSink,
  { result: fileResult, data }: ReplayFile,
): Promise<void> {
  const { testPath } = fileResult;
  const fileTaskId = getFileTaskId(testPath);

  const nodes = new Map<string, TestInfo>();
  indexTree(data.tests, nodes);
  const caseResults = new Map(fileResult.results.map((r) => [r.testId, r]));

  for (const event of data.events) {
    switch (event.h) {
      // The live runner reports the file before it is loaded, so its tree is
      // still empty at `start`; the `ready` event carries the collected one.
      // Not every result has a `start` — a file skipped by the cross-file bail
      // check reports a result without ever starting — so the track decides.
      case 'start':
        await sink.onTestFileStart({
          testId: fileTaskId,
          testPath,
          project: fileResult.project,
          tests: [],
        });
        break;
      case 'ready':
        await sink.onTestFileReady({
          testId: fileTaskId,
          testPath,
          project: fileResult.project,
          tests: data.tests,
        });
        break;
      case 'log':
        await sink.emitConsoleLog(event.log);
        break;
      case 'suiteResult':
        await sink.onTestSuiteResult(event.result);
        break;
      // The `type` checks below narrow `TestInfo` to the hook's payload type;
      // the tree always holds the node the event names.
      case 'suiteStart': {
        const node = nodes.get(event.id);
        if (node?.type === 'suite') {
          await sink.onTestSuiteStart(node);
        }
        break;
      }
      case 'caseStart': {
        const node = nodes.get(event.id);
        if (node?.type === 'case') {
          sink.onTestCaseStart(node);
        }
        break;
      }
      case 'caseResult': {
        const result = caseResults.get(event.id);
        if (result) {
          await sink.onTestCaseResult(result);
        }
        break;
      }
    }
  }

  await sink.onTestFileResult(fileResult);
}

function mergeBlobCoverage(blob: BlobData, coverageMap: CoverageMap): boolean {
  if (!blob.coverage) {
    return false;
  }

  coverageMap.merge(blob.coverage);
  return true;
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
  const coverageOptions = context.normalizedConfig.coverage;
  if (coverageOptions.enabled) {
    await ensureCoverageProviderInstalled(coverageOptions, context.rootPath);
  }
  const coverageProvider = coverageOptions.enabled
    ? await createCoverageProvider(coverageOptions, context.rootPath)
    : null;

  const relativeBlobDir = relative(context.rootPath, blobDir) || '.';
  logger.log(
    `\nMerging ${color.bold(String(blobs.length))} blob ${blobs.length === 1 ? 'report' : 'reports'} from ${color.cyan(relativeBlobDir)}\n`,
  );

  const replayFiles: ReplayFile[] = [];
  const allTestResults: TestResult[] = [];
  const allDurations: Duration[] = [];
  const shardDurations: { label: string; duration: Duration }[] = [];
  const allSnapshotSummaries: SnapshotSummary[] = [];
  const allUnhandledErrors: Error[] = [];
  const mergedCoverageMap = coverageProvider?.createCoverageMap();
  let hasCoverage = false;

  for (const blob of blobs) {
    allTestResults.push(...blob.testResults);
    allDurations.push(blob.duration);
    allSnapshotSummaries.push(blob.snapshotSummary);

    const shardLabel = blob.shard
      ? `Shard ${blob.shard.index}/${blob.shard.count}`
      : 'Shard';
    shardDurations.push({ label: shardLabel, duration: blob.duration });

    if (mergedCoverageMap && mergeBlobCoverage(blob, mergedCoverageMap)) {
      hasCoverage = true;
    }
    // Merged (or unusable) either way — release the raw shard payload before
    // the replay below, which holds `blobs` alive for its whole duration.
    blob.coverage = undefined;

    if (blob.unhandledErrors) {
      for (const e of blob.unhandledErrors) {
        const error = new Error(e.message);
        error.name = e.name || 'Error';
        error.stack = e.stack;
        allUnhandledErrors.push(error);
      }
    }

    for (const result of blob.results) {
      const data = blob.files?.[blobFileKey(result.project, result.testPath)];
      replayFiles.push({ result, data: data ?? { tests: [], events: [] } });
    }
  }

  const allResults: TestFileResult[] = replayFiles.map((file) => file.result);
  const mergedDuration = mergeDurations(allDurations);
  const mergedSnapshotSummary = mergeSnapshots(allSnapshotSummaries);
  const mergedCoverage: CoverageMapData | undefined =
    hasCoverage && mergedCoverageMap ? mergedCoverageMap.toJSON() : undefined;

  const hasFailure =
    allResults.some((r) => r.status === 'fail') ||
    allUnhandledErrors.length > 0;

  if (hasFailure) {
    process.exitCode = 1;
  }

  for (const reporter of context.reporters) {
    await reporter.onTestRunStart?.();
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

  // One sink per project, mirroring a live run: the sink binds the owning
  // project's config, so a multi-project merge must not replay every file
  // through the first project's.
  const sinks = new Map<string, RunnerEventSink>(
    context.projects.map((project) => [
      project.name,
      createRunnerEventSink(context, project.normalizedConfig),
    ]),
  );
  const [fallbackSink] = sinks.values();

  for (const file of replayFiles) {
    await replayTestFile(sinks.get(file.result.project) ?? fallbackSink!, file);
  }

  for (const reporter of context.reporters) {
    await reporter.onTestRunEnd?.({
      results: allResults,
      coverage: mergedCoverage,
      testResults: allTestResults,
      duration: mergedDuration,
      snapshotSummary: mergedSnapshotSummary,
      unhandledErrors: allUnhandledErrors.length
        ? allUnhandledErrors
        : undefined,
      getSourcemap: async () => null,
    });
    if (reporter.flushOutputStreams !== false) {
      await flushOutputStreams();
    }
  }

  if (
    coverageProvider &&
    mergedCoverageMap &&
    (!hasFailure || coverageOptions.reportOnFailure)
  ) {
    const { generateCoverage } = await import('../coverage/generate');
    await generateCoverage(context, mergedCoverageMap, coverageProvider);
  }

  if (cleanup && existsSync(blobDir)) {
    rmSync(blobDir, { recursive: true });
    logger.log(
      color.gray(`Cleaned up blob reports directory: ${relativeBlobDir}\n`),
    );
  }
}
