import type { TestFileInfo, TestResult } from './testSuite';

export type RunnerHooks = {
  /**
   * Called before test file run.
   */
  onTestFileStart?: (test: TestFileInfo) => Promise<void>;
  /**
   * Called after the test is finished running.
   */
  onTestCaseResult?: (result: TestResult) => Promise<void>;
};
