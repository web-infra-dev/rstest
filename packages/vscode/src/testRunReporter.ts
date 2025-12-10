import type {
  Reporter,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestSuiteInfo,
} from '@rstest/core';
import vscode from 'vscode';
import { ROOT_SUITE_NAME } from '../../core/src/utils/constants';
import { parseErrorStacktrace } from '../../core/src/utils/error';
import { logger } from './logger';
import type { Project } from './project';
import type { LogLevel } from './shared/logger';
import { TestFile, testData } from './testTree';

export class TestRunReporter implements Reporter {
  constructor(
    private run?: vscode.TestRun,
    private project?: Project,
    private path: string[] = [],
    private onFinish?: () => void,
    private createTestRun?: () => vscode.TestRun,
  ) {}

  public async log(level: LogLevel, message: string) {
    logger[level](message);
  }

  // pipe default reporter output to vscode test results panel
  onOutput(message: string) {
    this.run?.appendOutput(message.replaceAll('\n', '\r\n'));
  }

  private generatePath(value: TestCaseInfo | TestSuiteInfo | TestResult) {
    return value.name === ROOT_SUITE_NAME
      ? []
      : [...(value.parentNames || []), value.name];
  }
  private findTestItem(value: TestCaseInfo | TestSuiteInfo | TestResult) {
    const fileItem = this.project?.testFiles.get(
      vscode.Uri.file(value.testPath).toString(),
    )?.testItem;
    return this.generatePath(value).reduce<vscode.TestItem | undefined>(
      (item, name) => item?.children.get(name),
      fileItem,
    );
  }
  /** check whether current running suite/case contains reported suite/case */
  private contains(value: TestCaseInfo | TestSuiteInfo | TestResult) {
    const path = this.generatePath(value);
    if (path.length < this.path.length) return false;
    return this.path.every((name, index) => path[index] === name);
  }

  onTestFileStart(test: TestFileInfo) {
    // only update test file result when explicit run itself or parent
    if (this.path.length) return;

    const fileItem = this.project?.testFiles.get(
      vscode.Uri.file(test.testPath).toString(),
    )?.testItem;
    if (!fileItem) return;

    this.run?.started(fileItem);
  }
  onTestFileReady(test: TestFileInfo) {
    const fileTestItem = this.project?.testFiles.get(
      vscode.Uri.file(test.testPath).toString(),
    )?.testItem;
    if (fileTestItem) {
      const data = testData.get(fileTestItem);
      if (data instanceof TestFile) {
        data.updateFromList(test.tests);
      }
    }
  }
  onTestFileResult(test: TestFileResult) {
    // only update test file result when explicit run itself or parent
    if (this.path.length) return;

    const fileItem = this.project?.testFiles.get(
      vscode.Uri.file(test.testPath).toString(),
    )?.testItem;
    if (!fileItem) return;

    switch (test.status) {
      case 'todo':
      case 'skip':
        this.run?.skipped(fileItem);
        break;
      case 'pass':
        this.run?.passed(fileItem, test.duration);
        break;
      case 'fail':
        this.run?.failed(fileItem, [], test.duration);
        break;
    }
  }

  // just reuse test case hooks
  onTestSuiteStart(test: TestSuiteInfo) {
    this.onTestCaseStart(test);
  }
  onTestSuiteResult(result: TestResult) {
    this.onTestCaseResult(result);
  }

  onTestCaseStart(test: TestCaseInfo | TestSuiteInfo) {
    // ignore reported item not belongs current testItem
    if (!this.contains(test)) return;

    const testItem = this.findTestItem(test);
    if (!testItem) {
      logger.error('Cannot find testItem', test);
      return;
    }
    this.run?.started(testItem);
  }
  async onTestCaseResult(result: TestResult) {
    // if reported result is not belongs to current testItem, only update result when there's some suite before/after hooks error
    if (!this.contains(result)) {
      if (!result.errors?.length) return;
    }

    const testItem = this.findTestItem(result);
    if (!testItem) {
      logger.error('Cannot find testItem', result);
      return;
    }

    switch (result.status) {
      case 'pass': {
        this.run?.passed(testItem, result.duration);
        break;
      }
      case 'skip':
      case 'todo': {
        this.run?.skipped(testItem);
        break;
      }
      case 'fail': {
        this.run?.failed(
          testItem,
          await Promise.all(
            (result.errors || []).map(async (error) =>
              this.createError(error, result.testPath),
            ),
          ),
          result.duration,
        );
        break;
      }
    }
  }

  private isFirstRun = true;

  async onTestRunStart() {
    if (!this.isFirstRun) {
      this.run = this.createTestRun?.();
    }
  }

  async onTestRunEnd() {
    this.onFinish?.();
    if (!this.isFirstRun) {
      this.run?.end();
    }
    this.isFirstRun = false;
  }

  async onCoverage(
    uri: string,
    statementCoverage: vscode.TestCoverageCount,
    branchCoverage?: vscode.TestCoverageCount,
    declarationCoverage?: vscode.TestCoverageCount,
    details?: vscode.FileCoverageDetail[],
  ) {
    this.run?.addCoverage(
      new RstestFileCoverage(
        vscode.Uri.file(uri),
        statementCoverage,
        branchCoverage,
        declarationCoverage,
        details?.map((detail) => {
          const mapLocation = (location: vscode.Position | vscode.Range) => {
            if ('start' in location)
              return new vscode.Range(
                location.start.line,
                location.start.character,
                location.end.line,
                location.end.character,
              );
            return new vscode.Position(location.line, location.character);
          };
          return 'name' in detail
            ? new vscode.DeclarationCoverage(
                detail.name,
                detail.executed,
                mapLocation(detail.location),
              )
            : new vscode.StatementCoverage(
                detail.executed,
                mapLocation(detail.location),
                detail.branches.map(
                  (branch) =>
                    new vscode.BranchCoverage(
                      branch.executed,
                      branch.location && mapLocation(branch.location),
                    ),
                ),
              );
        }),
      ),
    );
  }

  private async createError(
    error: NonNullable<TestResult['errors']>[number],
    testPath: string,
  ) {
    const message =
      error.diff && error.expected !== undefined && error.actual !== undefined
        ? vscode.TestMessage.diff(error.message, error.expected, error.actual)
        : new vscode.TestMessage(error.message);

    if (
      error.diff &&
      // Snapshot `Foo > inner Foo > should return "foo" 1` mismatched
      error.message.startsWith('Snapshot ') &&
      error.message.endsWith(' mismatched')
    ) {
      message.contextValue = 'canUpdateSnapshot';
    }

    if (error.stack) {
      const frames = await parseErrorStacktrace({ stack: error.stack });

      // pick last frame which file equals current test file as error location
      const locationFrame = frames.findLast((frame) => frame.file === testPath);
      if (locationFrame?.lineNumber && locationFrame.column) {
        message.location = new vscode.Location(
          vscode.Uri.file(testPath),
          new vscode.Position(
            locationFrame.lineNumber - 1,
            locationFrame.column - 1,
          ),
        );
      }
      if (frames.length > 1 || !locationFrame)
        message.stackTrace = frames?.map(
          (frame) =>
            new vscode.TestMessageStackFrame(
              frame.methodName,
              frame.file ? vscode.Uri.file(frame.file) : undefined,
              frame.lineNumber && frame.column
                ? new vscode.Position(frame.lineNumber - 1, frame.column - 1)
                : undefined,
            ),
        );
    }

    return message;
  }
}

export class RstestFileCoverage extends vscode.FileCoverage {
  constructor(
    uri: vscode.Uri,
    statementCoverage: vscode.TestCoverageCount,
    branchCoverage?: vscode.TestCoverageCount,
    declarationCoverage?: vscode.TestCoverageCount,
    public readonly details: vscode.FileCoverageDetail[] = [],
  ) {
    super(uri, statementCoverage, branchCoverage, declarationCoverage);
  }
}
