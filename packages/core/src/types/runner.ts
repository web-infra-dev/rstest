import type { TestCaseInfo, TestResult } from './testSuite';

export type RunnerHooks = {
  /**
   * Called before running the test case.
   */
  onTestCaseStart?: (test: TestCaseInfo) => Promise<void>;

  /**
   * Called after the test is finished running.
   */
  onTestCaseResult?: (result: TestResult) => Promise<void>;

  /**
   * The number of failed tests.
   */
  getCountOfFailedTests: () => Promise<number>;
};
