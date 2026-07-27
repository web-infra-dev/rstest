import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'pathe';
import {
  createCoverageProvider,
  ensureCoverageProviderInstalled,
} from '../coverage';
import {
  type BlobData,
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
  UserConsoleLog,
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
  tests: TestInfo[];
  suiteResults: TestResult[];
  /** Recorded output, bucketed by the task it was written under. */
  logs: Map<string, UserConsoleLog[]>;
};

/**
 * Replays one file's lifecycle through the live-run dispatch path, so a
 * reporter sees the same hook sequence it would see during a real run.
 *
 * A tree node is replayed only when the blob holds a result for it: the live
 * runner fires `on*Start` and `on*Result` as a pair, and `bail` returns from a
 * task before either, so a missing result means nothing fired.
 */
async function replayTestFile(
  sink: RunnerEventSink,
  file: ReplayFile,
): Promise<void> {
  const { result: fileResult, tests, logs } = file;
  const { testPath } = fileResult;
  const fileTaskId = getFileTaskId(testPath);

  const pending = new Map(logs);
  const flushLogs = async (taskId: string): Promise<void> => {
    const bucket = pending.get(taskId);
    if (!bucket) {
      return;
    }
    pending.delete(taskId);
    for (const log of bucket) {
      await sink.emitConsoleLog(log);
    }
  };

  // The live runner reports the file before it is loaded, so its tree is still
  // empty here; `onTestFileReady` carries the collected one.
  await sink.onTestFileStart({ testId: fileTaskId, testPath, tests: [] });
  // Top-level module output is recorded against the file task, and live it is
  // written while the file loads — before collection finishes.
  await flushLogs(fileTaskId);
  await sink.onTestFileReady({ testId: fileTaskId, testPath, tests });

  const caseResults = new Map(fileResult.results.map((r) => [r.testId, r]));
  const suiteResults = new Map(file.suiteResults.map((r) => [r.testId, r]));

  const replayNodes = async (nodes: TestInfo[]): Promise<void> => {
    for (const node of nodes) {
      if (node.type === 'suite') {
        const result = suiteResults.get(node.testId);
        if (!result) {
          continue;
        }
        await sink.onTestSuiteStart(node);
        await flushLogs(node.testId);
        await replayNodes(node.tests);
        await sink.onTestSuiteResult(result);
      } else {
        const result = caseResults.get(node.testId);
        if (!result) {
          continue;
        }
        sink.onTestCaseStart(node);
        await flushLogs(node.testId);
        await sink.onTestCaseResult(result);
      }
    }
  };

  await replayNodes(tests);

  // Whatever is left belongs to a task the walk never reached (or to a blob
  // written before trees were persisted); emit it inside the file's window
  // rather than dropping it.
  for (const bucket of pending.values()) {
    for (const log of bucket) {
      await sink.emitConsoleLog(log);
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
  const orphanLogs: UserConsoleLog[] = [];
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

    // Bucketed by file, then by the task the log was written under, so each
    // file's replay can drop its output into the same slot the live run did.
    const logsByPath = new Map<string, Map<string, UserConsoleLog[]>>();
    for (const log of blob.consoleLogs ?? []) {
      let byTask = logsByPath.get(log.testPath);
      if (!byTask) {
        byTask = new Map();
        logsByPath.set(log.testPath, byTask);
      }
      const taskId = log.taskId ?? getFileTaskId(log.testPath);
      const bucket = byTask.get(taskId);
      if (bucket) {
        bucket.push(log);
      } else {
        byTask.set(taskId, [log]);
      }
    }

    for (const result of blob.results) {
      const data = blob.files?.[blobFileKey(result.project, result.testPath)];
      replayFiles.push({
        result,
        tests: data?.tests ?? [],
        suiteResults: data?.suiteResults ?? [],
        logs: logsByPath.get(result.testPath) ?? new Map(),
      });
      logsByPath.delete(result.testPath);
    }

    // Output recorded for a file that produced no result has no window to
    // replay into; keep it rather than losing it.
    for (const byTask of logsByPath.values()) {
      for (const bucket of byTask.values()) {
        orphanLogs.push(...bucket);
      }
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

  for (const log of orphanLogs) {
    await fallbackSink!.emitConsoleLog(log);
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
