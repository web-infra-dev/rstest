import fs from 'node:fs/promises';
import path from 'node:path';
import { relative } from 'pathe';
import type {
  JsonReporterOptions,
  Reporter,
  RunReport,
  SnapshotSummary,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from '../types';
import { getTaskNameWithPrefix, logger } from '../utils';

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
  private readonly rootPath: string;
  private readonly outputPath?: string;
  private readonly consoleLogs: UserConsoleLog[] = [];

  constructor({
    rootPath,
    options,
  }: {
    rootPath: string;
    options?: JsonReporterOptions;
  }) {
    this.rootPath = rootPath;
    this.outputPath = options?.outputPath;
  }

  onUserConsoleLog(log: UserConsoleLog): void {
    this.consoleLogs.push(log);
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
    runReport,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    runReport: RunReport;
  }): JsonReport {
    const { counts, duration, snapshot, status, unhandledErrors } = runReport;

    return {
      tool: 'rstest',
      version: RSTEST_VERSION,
      status,
      summary: { ...counts },
      durationMs: {
        total: duration.totalTime,
        build: duration.buildTime,
        tests: duration.testTime,
      },
      snapshot,
      files: results.map((fileResult) => ({
        ...fileResult,
        testPath: relative(this.rootPath, fileResult.testPath),
        fullName: getTaskNameWithPrefix(fileResult),
        results: fileResult.results.map((test) => this.normalizeTest(test)),
      })),
      tests: testResults.map((test) => this.normalizeTest(test)),
      consoleLogs:
        this.consoleLogs.length > 0
          ? this.consoleLogs.map((log) => ({
              ...log,
              testPath: relative(this.rootPath, log.testPath),
            }))
          : undefined,
      unhandledErrors: unhandledErrors.length > 0 ? unhandledErrors : undefined,
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
    runReport,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    runReport: RunReport;
  }): Promise<void> {
    const report = this.createReport({
      results,
      testResults,
      runReport,
    });

    await this.writeReport(`${JSON.stringify(report, null, 2)}\n`);
  }
}
