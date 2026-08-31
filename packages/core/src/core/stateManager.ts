import type { TestCaseInfo, TestFileResult, TestResult } from '../types';

export class TestStateManager {
  public runningModules: Map<
    string,
    {
      runningTests: TestCaseInfo[];
      results: TestResult[];
    }
  > = new Map<
    string,
    {
      runningTests: TestCaseInfo[];
      results: TestResult[];
    }
  >();

  public testModules: TestFileResult[] = [];
  public testFiles: string[] | undefined = undefined;
  private failedTestCount = 0;

  onTestFileStart(testPath: string): void {
    const currentModule = this.runningModules.get(testPath);
    if (currentModule) {
      this.failedTestCount -= currentModule.results.filter(
        (result) => result.status === 'fail',
      ).length;
    }
    this.runningModules.set(testPath, { runningTests: [], results: [] });
  }

  onTestCaseResult(result: TestResult): void {
    const currentModule = this.runningModules.get(result.testPath);
    if (!currentModule) {
      this.runningModules.set(result.testPath, {
        runningTests: [],
        results: [result],
      });
    } else {
      const runningTestIndex = currentModule.runningTests.findIndex(
        (test) => test.testId === result.testId,
      );
      if (runningTestIndex !== -1) {
        currentModule.runningTests.splice(runningTestIndex, 1);
      }
      currentModule.results.push(result);
    }
    if (result.status === 'fail') {
      this.failedTestCount++;
    }
  }

  onTestCaseStart(test: TestCaseInfo): void {
    const currentModule = this.runningModules.get(test.testPath);
    if (!currentModule) {
      this.runningModules.set(test.testPath, {
        runningTests: [test],
        results: [],
      });
    } else {
      const runningTestIndex = currentModule.runningTests.findIndex(
        (runningTest) => runningTest.testId === test.testId,
      );
      if (runningTestIndex !== -1) {
        currentModule.runningTests.splice(runningTestIndex, 1);
      }
      currentModule.runningTests.push(test);
    }
  }

  getCountOfFailedTests(): number {
    return this.failedTestCount;
  }

  onTestFileResult(test: TestFileResult): void {
    const currentModule = this.runningModules.get(test.testPath);
    if (currentModule) {
      this.failedTestCount -= currentModule.results.filter(
        (result) => result.status === 'fail',
      ).length;
    }
    this.runningModules.delete(test.testPath);
    this.failedTestCount +=
      test.results.length > 0
        ? test.results.filter((result) => result.status === 'fail').length
        : test.status === 'fail'
          ? 1
          : 0;
    this.testModules.push(test);
  }

  reset(): void {
    this.runningModules.clear();
    this.testModules = [];
    this.testFiles = undefined;
    this.failedTestCount = 0;
  }
}
