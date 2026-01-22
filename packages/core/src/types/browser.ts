import type { TestFileResult, TestResult } from './testSuite';

/**
 * Options for running browser tests.
 */
export interface BrowserTestRunOptions {
  /**
   * If true, browser mode will not call onTestRunEnd reporter hook.
   * This allows the caller to unify reporter output with node mode tests.
   */
  skipOnTestRunEnd?: boolean;
}

/**
 * Result from running browser tests.
 */
export interface BrowserTestRunResult {
  /** Test file results */
  results: TestFileResult[];
  /** Individual test case results */
  testResults: TestResult[];
  /** Duration information */
  duration: {
    totalTime: number;
    buildTime: number;
    testTime: number;
  };
  /** Whether the test run had failures */
  hasFailure: boolean;
}
