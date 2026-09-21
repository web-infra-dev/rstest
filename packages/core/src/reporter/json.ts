import fs from 'node:fs/promises';
import path from 'node:path';
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
import { logger } from '../utils';
import { PerFileEventBuffer, toReportCounts, toReportDuration } from './utils';

type JsonReport = {
  tool: 'rstest';
  version: string;
  status: TestRunEndPayload['status'];
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
  consoleLogs?: Array<
    Omit<UserConsoleLog, 'relativeTestPath'> & { testPath: string }
  >;
  unhandledErrors?: { message: string; stack?: string; name?: string }[];
};

export class JsonReporter implements Reporter {
  private readonly outputPath?: string;
  private readonly logs = new PerFileEventBuffer<UserConsoleLog>();

  constructor({
    options,
  }: {
    config: NormalizedConfig;
    rootPath: string;
    options?: JsonReporterOptions;
  }) {
    this.outputPath = options?.outputPath;
  }

  // A watch rerun replays the whole file, so its previous logs are stale.
  // Dropping them in place keeps `consoleLogs` in global arrival order, which is
  // the only temporal signal the payload carries.
  onTestFileStart(test: TestFileInfo): void {
    this.logs.reset(test);
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.logs.push(log, log);
  }

  private normalizeTest(test: TestResult): JsonReport['tests'][number] {
    return {
      ...test,
      testPath: test.relativeTestPath,
    };
  }

  private createReport({
    results,
    testResults,
    duration,
    snapshotSummary,
    unhandledErrors,
    summary,
    status,
  }: TestRunEndPayload): JsonReport {
    const logs = this.logs.get();
    return {
      tool: 'rstest',
      version: RSTEST_VERSION,
      status,
      summary: toReportCounts(summary),
      durationMs: toReportDuration(duration),
      snapshot: snapshotSummary,
      files: results.map((fileResult) => ({
        ...fileResult,
        testPath: fileResult.relativeTestPath,
        results: fileResult.results.map((test) => this.normalizeTest(test)),
      })),
      tests: testResults.map((test) => this.normalizeTest(test)),
      consoleLogs: logs.length
        ? logs.map(({ relativeTestPath, ...log }) => ({
            ...log,
            testPath: relativeTestPath,
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
    this.logs.prune(results);

    const report = this.createReport(payload);

    await this.writeReport(`${JSON.stringify(report, null, 2)}\n`);
  }
}
