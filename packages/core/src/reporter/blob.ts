import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import type { RunnerLifecycleEvent } from '../core/runnerEventSink';
import type {
  CoverageMapData,
  Duration,
  NormalizedConfig,
  Reporter,
  SerializedError,
  ShardConfig,
  SnapshotSummary,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestRunEndPayload,
  TestRunStartPayload,
  TestSuiteInfo,
  UserConsoleLog,
} from '../types';
import type { BlobReporterOptions } from '../types/reporter';
import { color } from '../utils';
import { PerFileEventBuffer } from './utils';

/**
 * One recorded lifecycle event: the hook that fired, with the payload the
 * reporter received, verbatim. Replay is playback, never reconstruction —
 * every payload rebuilt from other blob data has eventually diverged from
 * what the live run emitted (an order a tree walk cannot represent, a
 * `startTime` only the live event carries).
 */
type BlobFileEvent =
  | { h: 'start' | 'ready'; test: TestFileInfo }
  | { h: 'suiteStart'; test: TestSuiteInfo }
  | { h: 'caseStart'; test: TestCaseInfo }
  | { h: 'suiteResult' | 'caseResult'; result: TestResult }
  | { h: 'log'; log: UserConsoleLog };

/**
 * One file's replay track — what `TestFileResult` cannot carry: `results`
 * holds case results only, with no record of what fired or in what order.
 */
export type BlobFileData = {
  events: BlobFileEvent[];
};

export type BlobData = {
  version: string;
  runStart: TestRunStartPayload;
  shard?: ShardConfig;
  results: TestFileResult[];
  coverage?: CoverageMapData;
  testResults: TestResult[];
  duration: Duration;
  snapshotSummary: SnapshotSummary;
  unhandledErrors: SerializedError[];
  /** Keyed by {@link blobFileKey}. */
  files: Record<string, BlobFileData>;
};

const DEFAULT_OUTPUT_DIR = '.rstest-reports';
const BLOB_FORMAT_VERSION = `${RSTEST_VERSION}:2`;

/**
 * Single owner of the on-disk blob filename grammar. The writer (this module)
 * and the merge reader (`mergeReports.ts`) previously encoded the
 * `blob[-index-count].json` shape independently — a string template here and a
 * hand-written regexp there — so a rename would silently desync the two sides.
 */
export const blobFileName = (shard?: ShardConfig): string =>
  shard ? `blob-${shard.index}-${shard.count}.json` : 'blob.json';

export const BLOB_FILE_RE: RegExp = /^blob(-\d+-\d+)?\.json$/;

export const isBlobFile = (name: string): boolean => BLOB_FILE_RE.test(name);

/**
 * Parses a blob file and gates it on the writer's version. Blob payload shapes
 * are internal and unversioned beyond this field, so a skew between shards
 * would silently drop or misread data — reject it instead of merging partially.
 */
export const parseBlobFile = (content: string, fileName: string): BlobData => {
  let blob: BlobData | null;
  try {
    blob = JSON.parse(content) as BlobData | null;
  } catch (error) {
    throw new Error(
      `Blob report ${color.cyan(fileName)} is not valid JSON — the file may be truncated or corrupted. Regenerate it with --reporters=blob.`,
      { cause: error },
    );
  }
  if (blob?.version !== BLOB_FORMAT_VERSION) {
    throw new Error(
      `Blob report ${color.cyan(fileName)} uses format ${color.yellow(blob?.version || 'unknown')}, but this Rstest version requires format ${color.yellow(BLOB_FORMAT_VERSION)}.\n` +
        'Blob reports must match both the Rstest version and reporter format. Regenerate them with --reporters=blob.',
    );
  }
  return blob;
};

/**
 * Single owner of the `BlobData.files` key grammar: both sides must key through
 * here, never by test path alone — a path is ambiguous once several projects
 * run the same file. Every producer carries its project on its own payload;
 * the reader takes `TestFileResult.project`, or parses the project back out
 * of the key when a track has no result.
 */
export const blobFileKey = (project: string, testPath: string): string =>
  JSON.stringify([project, testPath]);

/**
 * Reads the project back out of a {@link blobFileKey} — the only field the
 * reader needs when a track has no result to take it from.
 */
export const blobFileKeyProject = (key: string): string =>
  (JSON.parse(key) as [string, string])[0];

export class BlobReporter implements Reporter {
  // Blob output goes to a file, never process stdout/stderr.
  readonly flushOutputStreams = false;

  private readonly config: NormalizedConfig;
  private readonly outputDir: string;
  private cancelled = false;
  private runStart: TestRunStartPayload = { files: [] };
  // One track per file, for a single one-shot run: watch mode is rejected at
  // reporter construction (`rstest.ts`), so no track ever spans two cycles.
  private readonly events = new PerFileEventBuffer<BlobFileEvent>();

  constructor({
    rootPath,
    config,
    options,
  }: {
    rootPath: string;
    config: NormalizedConfig;
    options?: BlobReporterOptions;
  }) {
    this.config = config;
    this.outputDir = options?.outputDir
      ? join(rootPath, options.outputDir)
      : join(rootPath, DEFAULT_OUTPUT_DIR);
  }

  onTestRunStart(payload: TestRunStartPayload): void {
    this.runStart = payload;
  }

  onTestFileStart(test: TestFileInfo): void {
    this.events.push({ h: 'start', test }, test);
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.events.push({ h: 'log', log }, log);
  }

  onTestFileReady(test: TestFileInfo): void {
    this.events.push({ h: 'ready', test }, test);
  }

  onTestSuiteStart(test: TestSuiteInfo): void {
    this.events.push({ h: 'suiteStart', test }, test);
  }

  onTestSuiteResult(result: TestResult): void {
    this.events.push({ h: 'suiteResult', result }, result);
  }

  onTestCaseStart(test: TestCaseInfo): void {
    this.events.push({ h: 'caseStart', test }, test);
  }

  onTestCaseResult(result: TestResult): void {
    this.events.push({ h: 'caseResult', result }, result);
  }

  cancel(): void {
    this.cancelled = true;
    rmSync(join(this.outputDir, blobFileName(this.config.shard)), {
      force: true,
    });
  }

  async onTestRunEnd({
    results,
    coverage,
    testResults,
    duration,
    snapshotSummary,
    unhandledErrors,
  }: TestRunEndPayload): Promise<void> {
    if (this.cancelled) return;
    const shard = this.config.shard;
    const fileName = blobFileName(shard);

    const blobData: BlobData = {
      version: BLOB_FORMAT_VERSION,
      runStart: this.runStart,
      shard: shard ? { index: shard.index, count: shard.count } : undefined,
      results,
      coverage,
      testResults,
      duration,
      snapshotSummary,
      unhandledErrors,
      files: Object.fromEntries(
        this.events
          .entries()
          .map(([file, events]) => [
            blobFileKey(file.project, file.testPath),
            { events },
          ]),
      ),
    };

    mkdirSync(this.outputDir, { recursive: true });
    writeFileSync(
      join(this.outputDir, fileName),
      JSON.stringify(blobData),
      'utf-8',
    );
  }
}

/**
 * Compile guard: every runner lifecycle event must be recorded on the track —
 * a hook missing here is an event replay silently drops. The console event is
 * recorded under its `Reporter` hook name, and file results deliberately
 * travel on `BlobData.results`, not the track.
 */
type RecordedHook =
  Exclude<RunnerLifecycleEvent, 'onConsoleLog'> | 'onUserConsoleLog';
type _TrackRecordsEveryRunnerEvent = RecordedHook extends keyof BlobReporter
  ? true
  : never;
export const BLOB_TRACK_MATCHES_RUNNER_EVENTS: _TrackRecordsEveryRunnerEvent = true;
