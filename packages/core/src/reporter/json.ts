import fs from 'node:fs/promises';
import path from 'node:path';
import { relative } from 'pathe';
import type {
  Duration,
  JsonReporterOptions,
  NormalizedConfig,
  Reporter,
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
  private readonly config: NormalizedConfig;
  private readonly rootPath: string;
  private readonly outputPath?: string;
  private readonly consoleLogs: UserConsoleLog[] = [];

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
    const failedTests = testResults.filter(
      (result) => result.status === 'fail',
    );
    const passedTests = testResults.filter(
      (result) => result.status === 'pass',
    );
    const skippedTests = testResults.filter(
      (result) => result.status === 'skip',
    );
    const todoTests = testResults.filter((result) => result.status === 'todo');
    const failedFiles = results.filter((result) => result.status === 'fail');
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
      summary: {
        testFiles: results.length,
        failedFiles: failedFiles.length,
        tests: testResults.length,
        failedTests: failedTests.length,
        passedTests: passedTests.length,
        skippedTests: skippedTests.length,
        todoTests: todoTests.length,
      },
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
      consoleLogs:
        this.consoleLogs.length > 0
          ? this.consoleLogs.map((log) => ({
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
