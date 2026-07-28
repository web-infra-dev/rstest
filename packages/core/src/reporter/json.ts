import fs from 'node:fs/promises';
import path from 'node:path';
import { relative } from 'pathe';
import type {
  Duration,
  JsonReporterOptions,
  NormalizedConfig,
  Reporter,
  SnapshotSummary,
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { getTaskNameWithPrefix, logger } from '../utils';
import { deriveRunCounts, reporterFileKey } from './utils';

type JsonReport = {
  tool: 'rstest';
  version: string;
  status: 'pass' | 'fail';
  summary: {
    testFiles: number;
    failedFiles: number;
    tests: number;
    failedTests: number;
    passedTests: number;
    skippedTests: number;
    todoTests: number;
  };
  durationMs: {
    total: number;
    build: number;
    tests: number;
  };
  snapshot: SnapshotSummary;
  files: Array<
    Omit<TestFileResult, 'results' | 'testPath'> & {
      testPath: string;
      fullName: string;
      results: Array<
        Omit<TestResult, 'testPath'> & {
          testPath: string;
          fullName: string;
        }
      >;
    }
  >;
  tests: Array<
    Omit<TestResult, 'testPath'> & {
      testPath: string;
      fullName: string;
    }
  >;
  consoleLogs?: Array<UserConsoleLog & { testPath: string }>;
  unhandledErrors?: { message: string; stack?: string; name?: string }[];
};

export class JsonReporter implements Reporter {
  private readonly config: NormalizedConfig;
  private readonly rootPath: string;
  private readonly outputPath?: string;
  private logs: UserConsoleLog[] = [];

  constructor({
    config,
    rootPath,
    options,
  }: {
    config: NormalizedConfig;
    rootPath: string;
    options?: JsonReporterOptions;
  }) {
    this.config = config;
    this.rootPath = rootPath;
    this.outputPath = options?.outputPath;
  }

  // A watch rerun replays the whole file, so its previous logs are stale.
  // Dropping them in place keeps `consoleLogs` in global arrival order, which is
  // the only temporal signal the payload carries.
  onTestFileStart(test: TestFileInfo): void {
    this.logs = this.logs.filter(
      (log) => log.project !== test.project || log.testPath !== test.testPath,
    );
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.logs.push(log);
  }

  private normalizeTest(test: TestResult): JsonReport['tests'][number] {
    return {
      ...test,
      testPath: relative(this.rootPath, test.testPath),
      fullName: getTaskNameWithPrefix(test),
    };
  }

  private createReport({
    results,
    testResults,
    duration,
    snapshotSummary,
    unhandledErrors,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    unhandledErrors?: Error[];
  }): JsonReport {
    const { failedTests, failedFiles, counts } = deriveRunCounts({
      results,
      testResults,
    });
    const noTestsDiscovered = results.length === 0 && testResults.length === 0;
    const hasFailedStatus =
      failedTests.length > 0 ||
      failedFiles.length > 0 ||
      (unhandledErrors?.length ?? 0) > 0 ||
      (noTestsDiscovered && !this.config.passWithNoTests);

    return {
      tool: 'rstest',
      version: RSTEST_VERSION,
      status: hasFailedStatus ? 'fail' : 'pass',
      summary: counts,
      durationMs: {
        total: duration.totalTime,
        build: duration.buildTime,
        tests: duration.testTime,
      },
      snapshot: snapshotSummary,
      files: results.map((fileResult) => ({
        ...fileResult,
        testPath: relative(this.rootPath, fileResult.testPath),
        fullName: getTaskNameWithPrefix(fileResult),
        results: fileResult.results.map((test) => this.normalizeTest(test)),
      })),
      tests: testResults.map((test) => this.normalizeTest(test)),
      consoleLogs: this.logs.length
        ? this.logs.map((log) => ({
            ...log,
            testPath: relative(this.rootPath, log.testPath),
          }))
        : undefined,
      unhandledErrors: unhandledErrors?.map((error) => ({
        message: error.message,
        stack: error.stack,
        name: error.name,
      })),
    };
  }

  private async writeReport(content: string): Promise<void> {
    if (!this.outputPath) {
      logger.log(content);
      return;
    }

    try {
      await fs.mkdir(path.dirname(this.outputPath), { recursive: true });
      await fs.writeFile(this.outputPath, content, 'utf-8');
      logger.log(`JSON report written to: ${this.outputPath}`);
    } catch (error) {
      logger.stderr(
        `Failed to write JSON report to ${this.outputPath}:`,
        error,
      );
      logger.log(content);
    }
  }

  async onTestRunEnd({
    results,
    testResults,
    duration,
    snapshotSummary,
    unhandledErrors,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    snapshotSummary: SnapshotSummary;
    unhandledErrors?: Error[];
  }): Promise<void> {
    // A watch session drops deleted files from the result snapshot; the buffered
    // logs have no such signal of their own, so the reported file set prunes
    // them. Without this the report would carry logs for a file it does not
    // list, and the buffer would grow for the whole session.
    const reportedFiles = new Set(
      results.map((result) => reporterFileKey(result.project, result.testPath)),
    );
    this.logs = this.logs.filter((log) =>
      reportedFiles.has(reporterFileKey(log.project, log.testPath)),
    );

    const report = this.createReport({
      results,
      testResults,
      duration,
      snapshotSummary,
      unhandledErrors,
    });

    await this.writeReport(`${JSON.stringify(report, null, 2)}\n`);
  }
}
