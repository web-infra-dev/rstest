import type {
  RstestTestState,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
} from '../types';

export class TestStateManager {
  public runningModules: ReturnType<RstestTestState['getRunningModules']> =
    new Map();

  public testModules: TestFileResult[] = [];
  public testFiles: string[] | undefined = undefined;
  private failedTestCount = 0;

  onTestFileStart({ testPath, relativeTestPath }: TestFileInfo): void {
    const currentModule = this.runningModules.get(testPath);
    if (currentModule) {
      this.failedTestCount -= currentModule.results.filter(
        (result) => result.status === 'failed',
      ).length;
    }
    this.runningModules.set(testPath, {
      relativeTestPath,
      runningTests: [],
      results: [],
    });
  }

  onTestCaseResult(result: TestResult): void {
    const currentModule = this.runningModules.get(result.testPath);
    if (!currentModule) {
      this.runningModules.set(result.testPath, {
        relativeTestPath: result.relativeTestPath,
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
    if (result.status === 'failed') {
      this.failedTestCount++;
    }
  }

  onTestCaseStart(test: TestCaseInfo): void {
    const currentModule = this.runningModules.get(test.testPath);
    if (!currentModule) {
      this.runningModules.set(test.testPath, {
        relativeTestPath: test.relativeTestPath,
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
        (result) => result.status === 'failed',
      ).length;
    }
    this.runningModules.delete(test.testPath);
    this.failedTestCount +=
      test.results.length > 0
        ? test.results.filter((result) => result.status === 'failed').length
        : test.status === 'failed'
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
