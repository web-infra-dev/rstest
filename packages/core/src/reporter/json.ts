import fs from 'node:fs/promises';
import path from 'node:path';
import { relative } from 'pathe';
import type {
  JsonReporterOptions,
  NormalizedConfig,
  Reporter,
  SnapshotSummary,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestRunEndPayload,
  UserConsoleLog,
} from '../types';
import { getTaskNameWithPrefix, logger } from '../utils';
import {
  reportedFileKeys,
  reporterFileKey,
  toReportCounts,
  toReportDuration,
} from './utils';

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
    if (!this.logs.length) {
      return;
    }
    const key = reporterFileKey(test.project, test.testPath);
    this.logs = this.logs.filter(
      (log) => reporterFileKey(log.project, log.testPath) !== key,
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
    summary,
  }: TestRunEndPayload): JsonReport {
    const noTestsDiscovered = results.length === 0 && testResults.length === 0;
    const hasFailedStatus =
      summary.tests.failed > 0 ||
      summary.files.failed > 0 ||
      unhandledErrors.length > 0 ||
      (noTestsDiscovered && !this.config.passWithNoTests);

    return {
      tool: 'rstest',
      version: RSTEST_VERSION,
      status: hasFailedStatus ? 'fail' : 'pass',
      summary: toReportCounts(summary),
      durationMs: toReportDuration(duration),
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
      unhandledErrors: unhandledErrors.map((error) => ({
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

  async onTestRunEnd(payload: TestRunEndPayload): Promise<void> {
    const { results } = payload;
    // A watch session drops deleted files from the result snapshot; the buffered
    // logs have no such signal of their own, so the reported file set prunes
    // them. Without this the report would carry logs for a file it does not
    // list, and the buffer would grow for the whole session.
    if (this.logs.length) {
      const reportedKeys = reportedFileKeys(results);
      this.logs = this.logs.filter((log) =>
        reportedKeys.has(reporterFileKey(log.project, log.testPath)),
      );
    }

    const report = this.createReport(payload);

    await this.writeReport(`${JSON.stringify(report, null, 2)}\n`);
  }
}
