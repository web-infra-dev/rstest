import type {
  TestCaseInfo,
  TestFileInfo,
  TestResult,
  TestSuiteInfo,
} from './testSuite';

export type RunnerHooks = {
  /**
   * Called around snapshot client setup and finish so transports can apply a
   * framework-level watchdog to snapshot lifecycle RPCs.
   */
  onSnapshotSetupStart?: () => Promise<void>;
  onSnapshotSetupEnd?: () => Promise<void>;
  onSnapshotFinishStart?: () => Promise<void>;
  onSnapshotFinishEnd?: () => Promise<void>;
  onTestSuiteStart?: (test: TestSuiteInfo) => Promise<void>;
  onTestSuiteResult?: (result: TestResult) => Promise<void>;
  /**
   * Called after tests in file collected.
   */
  onTestFileReady?: (test: TestFileInfo) => Promise<void>;
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
