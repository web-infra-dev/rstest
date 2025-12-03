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
import { testItemType } from './testTree';

export class TestRunReporter implements Reporter {
  private fileItem: vscode.TestItem;
  private path: string[];
  constructor(
    private run: vscode.TestRun,
    private testItem: vscode.TestItem,
  ) {
    let fileItem: vscode.TestItem | undefined = testItem;
    const path: string[] = [];

    while (
      fileItem &&
      (testItemType.get(fileItem) === 'suite' ||
        testItemType.get(fileItem) === 'case')
    ) {
      path.unshift(fileItem.label);
      fileItem = fileItem.parent;
    }

    if (!fileItem) throw new Error('Cannot find test file');

    this.fileItem = fileItem;
    this.path = path;
  }
  public getTestItemPath() {
    return this.path;
  }

  // pipe default reporter output to vscode test results panel
  onOutput(message: string) {
    this.run.appendOutput(message.replaceAll('\n', '\r\n'));
  }

  private generatePath(value: TestCaseInfo | TestSuiteInfo | TestResult) {
    return value.name === ROOT_SUITE_NAME
      ? []
      : [...(value.parentNames || []), value.name];
  }
  private findTestItem(value: TestCaseInfo | TestSuiteInfo | TestResult) {
    return this.generatePath(value).reduce<vscode.TestItem | undefined>(
      (item, name) => item?.children.get(name),
      this.fileItem,
    );
  }
  /** check whether current running suite/case contains reported suite/case */
  private contains(value: TestCaseInfo | TestSuiteInfo | TestResult) {
    const path = this.generatePath(value);
    if (path.length < this.path.length) return false;
    return this.path.every((name, index) => path[index] === name);
  }

  onTestFileStart(_test: TestFileInfo) {
    this.run.started(this.testItem);
  }
  onTestFileResult(test: TestFileResult) {
    // only update test file result when explicit run it
    if (this.path.length) return;

    switch (test.status) {
      case 'todo':
      case 'skip':
        this.run.skipped(this.fileItem);
        break;
      case 'pass':
        this.run.passed(this.fileItem, test.duration);
        break;
      case 'fail':
        this.run.failed(this.fileItem, [], test.duration);
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

  onTestCaseStart(test: TestCaseInfo) {
    // ignore reported item not belongs current testItem
    if (!this.contains(test)) return;

    const testItem = this.findTestItem(test);
    if (!testItem) {
      logger.error('Cannot find testItem', test);
      return;
    }
    this.run.started(testItem);
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
        this.run.passed(testItem, result.duration);
        break;
      }
      case 'skip':
      case 'todo': {
        this.run.skipped(testItem);
        break;
      }
      case 'fail': {
        this.run.failed(
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
