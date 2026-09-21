import type {
  RawTestCaseInfo,
  RawTestFileInfo,
  RawTestResult,
  RawTestSuiteInfo,
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
  onTestSuiteStart?: (test: RawTestSuiteInfo) => Promise<void>;
  onTestSuiteResult?: (result: RawTestResult) => Promise<void>;
  /**
   * Called after tests in file collected.
   */
  onTestFileReady?: (test: RawTestFileInfo) => Promise<void>;
  /**
   * Called before running the test case.
   */
  onTestCaseStart?: (test: RawTestCaseInfo) => Promise<void>;

  /**
   * Called after the test is finished running.
   */
  onTestCaseResult?: (result: RawTestResult) => Promise<void>;

  /**
   * The number of failed tests.
   */
  getCountOfFailedTests: () => Promise<number>;
};
