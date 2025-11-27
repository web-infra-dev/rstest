import type { TestFileResult, TestResult } from '../types';

export class TestStateManager {
  public runningModules: Map<string, TestResult[]> = new Map<
    string,
    TestResult[]
  >();
  public testModules: TestFileResult[] = [];

  onTestFileStart(testPath: string): void {
    this.runningModules.set(testPath, []);
  }

  onTestCaseResult(result: TestResult): void {
    this.runningModules.set(result.testPath, [
      ...(this.runningModules.get(result.testPath) || []),
      result,
    ]);
  }

  getCountOfFailedTests(): number {
    const testResults: TestResult[] = Array.from(this.runningModules.values())
      .flat()
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
  }
}
