import type { TestResult, TestSummaryResult } from './testSuite';

export type Duration = {
  totalTime: number;
  buildTime: number;
  testTime: number;
  prepareTime: number;
};
export interface Reporter {
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
