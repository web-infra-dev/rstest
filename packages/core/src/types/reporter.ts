import type { TestFileInfo, TestResult, TestSummaryResult } from './testSuite';

export type Duration = {
  totalTime: number;
  buildTime: number;
  testTime: number;
};
export interface Reporter {
  /**
   * Called before test file run.
   */
  onTestFileStart?: (test: TestFileInfo) => void;
  /**
   * Called when the test has finished running or was just skipped.
   */
  onTestCaseResult?: (result: TestResult) => void;
  /**
   * Called after all tests have finished running.
   */
  onTestRunEnd?: (
    results: TestSummaryResult[],
    testResults: TestResult[],
    duration: Duration,
  ) => void;
}
