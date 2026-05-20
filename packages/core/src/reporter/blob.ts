import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';
import type {
  CoverageMapData,
  Duration,
  NormalizedConfig,
  Reporter,
  RunReport,
  SnapshotSummary,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import type { BlobReporterOptions } from '../types/reporter';

export type BlobData = {
  version: string;
  shard?: { index: number; count: number };
  results: TestFileResult[];
  coverage?: CoverageMapData;
  testResults: TestResult[];
  duration: Duration;
  snapshotSummary: SnapshotSummary;
  unhandledErrors?: RunReport['unhandledErrors'];
  consoleLogs?: UserConsoleLog[];
};

const DEFAULT_OUTPUT_DIR = '.rstest-reports';

export class BlobReporter implements Reporter {
  private readonly config: NormalizedConfig;
  private readonly outputDir: string;
  private readonly consoleLogs: UserConsoleLog[] = [];

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

  onUserConsoleLog(log: UserConsoleLog): void {
    this.consoleLogs.push(log);
  }

  async onTestRunEnd({
    results,
    coverage,
    testResults,
    duration,
    snapshotSummary,
    runReport,
  }: {
    results: TestFileResult[];
    coverage?: CoverageMapData;
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    runReport: RunReport;
  }): Promise<void> {
    const shard = this.config.shard;
    const fileName = shard
      ? `blob-${shard.index}-${shard.count}.json`
      : 'blob.json';

    const blobData: BlobData = {
      version: RSTEST_VERSION,
      shard: shard ? { index: shard.index, count: shard.count } : undefined,
      results,
      coverage,
      testResults,
      duration,
      snapshotSummary,
      unhandledErrors: runReport.unhandledErrors.length
        ? runReport.unhandledErrors
        : undefined,
      consoleLogs: this.consoleLogs.length > 0 ? this.consoleLogs : undefined,
    };

    mkdirSync(this.outputDir, { recursive: true });
    writeFileSync(
      join(this.outputDir, fileName),
      JSON.stringify(blobData),
      'utf-8',
    );
  }
}
