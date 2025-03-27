import type { TestResult } from './testSuite';

export type RunnerHooks = {
  /**
   * Called after the test is finished running.
   */
  onTestCaseResult?: (result: TestResult) => Promise<void>;
};
