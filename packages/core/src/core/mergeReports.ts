import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'pathe';
import {
  cleanCoverageReports,
  createCoverageProvider,
  ensureCoverageProviderInstalled,
} from '../coverage';
import {
  type BlobData,
  type BlobFileData,
  blobFileKey,
  blobFileKeyProject,
  isBlobFile,
  parseBlobFile,
} from '../reporter/blob';
import type {
  CoverageMapData,
  Duration,
  SnapshotSummary,
  TestFileResult,
  TestResult,
} from '../types';
import type { CoverageMap } from '../types/coverage';
import { color, flushOutputStreams, logger, prettyTime } from '../utils';
import type { Rstest } from './rstest';
import { createRunnerEventSink, type RunnerEventSink } from './runnerEventSink';

const DEFAULT_BLOB_DIR = '.rstest-reports';

function loadBlobFiles(blobDir: string): {
  blobs: BlobData[];
  paths: string[];
} {
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

  return {
    blobs: files.map((file) =>
      parseBlobFile(readFileSync(join(blobDir, file), 'utf-8'), file),
    ),
    paths: files.map((file) => join(blobDir, file)),
  };
}

function cleanBlobReports(blobDir: string, reportsDirectory: string): void {
  if (lstatSync(blobDir).isSymbolicLink()) {
    unlinkSync(blobDir);
    return;
  }

  const reportsRelativePath = relative(blobDir, reportsDirectory);
  const reportsAreInsideBlobDirectory =
    reportsRelativePath !== '..' &&
    !reportsRelativePath.startsWith('../') &&
    !isAbsolute(reportsRelativePath);

  if (!reportsAreInsideBlobDirectory) {
    rmSync(blobDir, { recursive: true });
    return;
  }

  if (!reportsRelativePath) {
    for (const entry of readdirSync(blobDir)) {
      if (isBlobFile(entry)) {
        rmSync(join(blobDir, entry));
      }
    }
    return;
  }

  const [reportsChild] = reportsRelativePath.split('/');
  for (const entry of readdirSync(blobDir)) {
    if (entry !== reportsChild) {
      rmSync(join(blobDir, entry), { recursive: true });
    }
  }
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

/**
 * One test file's recorded lifecycle, reassembled from a single blob.
 * `result` is absent when the run recorded events but never produced a
 * `TestFileResult` — a browser client that goes fatal mid-file, for example —
 * in which case the track still replays, minus the file-result hook.
 */
type ReplayFile = {
  project: string;
  result?: TestFileResult;
  data: BlobFileData;
};

/**
 * Replays one file's recorded events through the live-run dispatch path:
 * every event carries the payload the live run emitted (see `BlobFileEvent`),
 * so replay is pure playback — a reporter sees the same hook sequence with
 * the same payloads it would see during a real run. Tracks replay one file
 * at a time: cross-file interleaving from parallel workers is deliberately
 * dropped — merged output reads like a `maxWorkers: 1` run, and no
 * cross-file order can exist across shard blobs anyway.
 */
async function replayTestFile(
  sink: RunnerEventSink,
  { result: fileResult, data }: ReplayFile,
): Promise<void> {
  for (const event of data.events) {
    switch (event.h) {
      case 'start':
        await sink.onTestFileStart(event.test);
        break;
      case 'ready':
        await sink.onTestFileReady(event.test);
        break;
      case 'suiteStart':
        await sink.onTestSuiteStart(event.test);
        break;
      case 'suiteResult':
        await sink.onTestSuiteResult(event.result);
        break;
      case 'caseStart':
        sink.onTestCaseStart(event.test);
        break;
      case 'caseResult':
        await sink.onTestCaseResult(event.result);
        break;
      case 'log':
        await sink.emitConsoleLog(event.log);
        break;
      default:
        event satisfies never;
    }
  }

  if (fileResult) {
    await sink.onTestFileResult(fileResult);
  }
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

  const { blobs, paths: blobPaths } = loadBlobFiles(blobDir);
  let coverageOptions = context.normalizedConfig.coverage;
  if (coverageOptions.enabled) {
    await ensureCoverageProviderInstalled(coverageOptions, context.rootPath);
  }
  if (coverageOptions.enabled && coverageOptions.include?.length) {
    const { prepareRsbuild } = await import('./rsbuild');
    const rsbuildInstance = await prepareRsbuild({
      context,
      targetProjects: context.projects,
      globTestSourceEntries: async () => ({}),
    });
    await rsbuildInstance.initConfigs({ action: 'dev' });
    coverageOptions = context.normalizedConfig.coverage;
  }

  if (coverageOptions.enabled) {
    cleanCoverageReports(coverageOptions, blobPaths);
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
    // Merged (or unusable) either way — drop the coverage payload, by far the
    // largest part of a blob, before the replay below, which holds `blobs`
    // alive for its whole duration.
    blob.coverage = undefined;

    if (blob.unhandledErrors) {
      for (const e of blob.unhandledErrors) {
        const error = new Error(e.message);
        error.name = e.name || 'Error';
        error.stack = e.stack;
        allUnhandledErrors.push(error);
      }
    }

    const claimed = new Set<string>();
    for (const result of blob.results) {
      const key = blobFileKey(result.project, result.testPath);
      claimed.add(key);
      replayFiles.push({
        project: result.project,
        result,
        data: blob.files[key] ?? { events: [] },
      });
    }

    // A track can outlive its result (see `ReplayFile`); its events still
    // fired live, so they still replay.
    for (const [key, data] of Object.entries(blob.files)) {
      if (!claimed.has(key)) {
        replayFiles.push({ project: blobFileKeyProject(key), data });
      }
    }
  }

  const allResults: TestFileResult[] = replayFiles
    .map((file) => file.result)
    .filter((result) => result !== undefined);
  const mergedDuration = mergeDurations(allDurations);
  const mergedSnapshotSummary = mergeSnapshots(allSnapshotSummaries);
  const mergedCoverage: CoverageMapData | undefined =
    hasCoverage && mergedCoverageMap ? mergedCoverageMap.toJSON() : undefined;

  const hasFailure =
    allResults.some((r) => r.status === 'fail') ||
    allUnhandledErrors.length > 0;

  if (hasFailure) {
    context.exitCode.raise(1);
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
  // Unlike the browser host's throwing lookup, a project-name miss here is
  // not a protocol bug: blobs are cross-run artifacts, so a project renamed
  // between recording and merging is user-reachable. Replay reads only
  // run-level context today, so any sink serves such a file.
  const [fallbackSink] = sinks.values();

  for (const file of replayFiles) {
    await replayTestFile(sinks.get(file.project) ?? fallbackSink!, file);
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

  const shouldGenerateCoverage =
    coverageProvider &&
    mergedCoverageMap &&
    (!hasFailure || coverageOptions.reportOnFailure);
  if (shouldGenerateCoverage) {
    const { generateCoverage } = await import('../coverage/generate');
    await generateCoverage(context, mergedCoverageMap, coverageProvider);
  }

  if (cleanup && existsSync(blobDir)) {
    if (shouldGenerateCoverage) {
      cleanBlobReports(blobDir, coverageOptions.reportsDirectory);
    } else {
      rmSync(blobDir, { recursive: true });
    }
    logger.log(
      color.gray(`Cleaned up blob reports from: ${relativeBlobDir}\n`),
    );
  }

  context.exitCode.finishCycle();
}
