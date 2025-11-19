import type { SnapshotResult } from '@vitest/snapshot';
import type {
  NormalizedFixtures,
  OnTestFailedHandler,
  OnTestFinishedHandler,
  TestContext,
} from './api';
import type { CoverageMapData } from './coverage';
import type { MaybePromise, TestPath } from './utils';

export type TestRunMode = 'run' | 'skip' | 'todo' | 'only';

export type TaskState = 'pass' | 'fail';

export interface TaskResult {
  /**
   * State of the task. Inherits the `task.mode` during collection.
   * When the task has finished, it will be changed to `pass` or `fail`.
   * - **pass**: task ran successfully
   * - **fail**: task failed
   */
  state: TaskState;
  /**
   * Errors that occurred during the task execution. It is possible to have several errors
   * if `expect.soft()` failed multiple times or `retry` was triggered.
   */
  errors?: FormattedError[];
}

export type TestCaseInfo = {
  testId: string;
  testPath: TestPath;
  name: string;
  timeout?: number;
  parentNames?: string[];
  project: string;
  startTime?: number;
};

export type TestCase = TestCaseInfo & {
  originalFn?: (context: TestContext) => void | Promise<void>;
  fn?: (context: TestContext) => void | Promise<void>;
  runMode: TestRunMode;
  fails?: boolean;
  each?: boolean;
  fixtures?: NormalizedFixtures;
  concurrent?: boolean;
  sequential?: boolean;
  inTestEach?: boolean;
  context: TestContext;
  only?: boolean;
  onFinished: OnTestFinishedHandler[];
  onFailed: OnTestFailedHandler[];
  type: 'case';
  /**
   * Store promises (from async expects) to wait for them before finishing the test
   */
  promises?: Promise<any>[];
  /**
   * Result of the task. if `expect.soft()` failed multiple times or `retry` was triggered.
   */
  result?: TaskResult;
};

export type SuiteContext = {
  filepath: TestPath;
};

export type AfterAllListener = (ctx: SuiteContext) => MaybePromise<void>;
export type BeforeAllListener = (
  ctx: SuiteContext,
) => MaybePromise<void | AfterAllListener>;
export type AfterEachListener = (params: {
  task: { result: Readonly<TestResult> };
}) => MaybePromise<void>;
export type BeforeEachListener = () => MaybePromise<void | AfterEachListener>;

export type TestSuite = {
  testId: string;
  name: string;
  parentNames?: string[];
  runMode: TestRunMode;
  each?: boolean;
  inTestEach?: boolean;
  concurrent?: boolean;
  sequential?: boolean;
  testPath: TestPath;
  project: string;
  /** nested cases and suite could in a suite */
  tests: (TestSuite | TestCase)[];
  type: 'suite';
  afterAllListeners?: AfterAllListener[];
  beforeAllListeners?: BeforeAllListener[];
  afterEachListeners?: AfterEachListener[];
  beforeEachListeners?: BeforeEachListener[];
};

export type TestSuiteListeners = keyof Pick<
  TestSuite,
  | 'afterAllListeners'
  | 'beforeAllListeners'
  | 'afterEachListeners'
  | 'beforeEachListeners'
>;

export type TestFileInfo = {
  testPath: TestPath;
};

export type Test = TestSuite | TestCase;

export type TestResultStatus = 'skip' | 'pass' | 'fail' | 'todo';

export type FormattedError = {
  fullStack?: boolean;
  message: string;
  name?: string;
  stack?: string;
  diff?: string;
};

export type TestResult = {
  testId: string;
  status: TestResultStatus;
  name: string;
  testPath: TestPath;
  parentNames?: string[];
  duration?: number;
  errors?: FormattedError[];
  retryCount?: number;
  project: string;
  heap?: number;
};

export type TestFileResult = TestResult & {
  results: TestResult[];
  snapshotResult?: SnapshotResult;
  coverage?: CoverageMapData;
};

export interface UserConsoleLog {
  content: string;
  name: string;
  trace?: string;
  testPath: TestPath;
  type: 'stdout' | 'stderr';
}
