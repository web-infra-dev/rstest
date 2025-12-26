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

  onTestFileStart(testPath: string): void {
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
      // Find and remove the test from runningTests by matching testId
      const filteredRunningTests = currentModule.runningTests.filter(
        (t) => t.testId !== result.testId,
      );
      this.runningModules.set(result.testPath, {
        runningTests: filteredRunningTests,
        results: [...currentModule.results, result],
      });
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
      // Remove from runningTests if it exists (for restart scenarios)
      const filteredRunningTests = currentModule.runningTests.filter(
        (t) => t.testId !== test.testId,
      );
      this.runningModules.set(test.testPath, {
        runningTests: [...filteredRunningTests, test],
        results: currentModule.results,
      });
    }
  }

  getCountOfFailedTests(): number {
    const testResults: TestResult[] = Array.from(this.runningModules.values())
      .flatMap(({ results }) => results)
      .concat(this.testModules.flatMap((mod) => mod.results));

    return testResults.filter((t) => t.status === 'fail').length;
  }

  onTestFileResult(test: TestFileResult): void {
    this.runningModules.delete(test.testPath);
    this.testModules.push(test);
  }

  reset(): void {
    this.runningModules.clear();
    this.testModules = [];
    this.testFiles = undefined;
  }
}
