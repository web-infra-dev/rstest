import type { SnapshotResult } from '@vitest/snapshot';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import type {
  NormalizedFixtures,
  OnTestFailedHandler,
  OnTestFinishedHandler,
  TestContext,
} from './api';
import type { ConsoleStreamType, MaybePromise, TestPath } from './utils';

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

export type Location = {
  line: number;
  column: number;
};

export type TestCaseInfo = {
  testId: string;
  testPath: TestPath;
  name: string;
  timeout?: number;
  parentNames?: string[];
  project: string;
  startTime?: number;
  /** Only included when `includeTaskLocation` config is enabled */
  location?: Location;
  type: 'case';
  runMode: TestRunMode;
};

export type TestCase = TestCaseInfo & {
  originalFn?: (context: TestContext) => void | Promise<void>;
  fn?: (context: TestContext) => void | Promise<void>;
  fails?: boolean;
  each?: boolean;
  fixtures?: NormalizedFixtures;
  concurrent?: boolean;
  sequential?: boolean;
  inTestEach?: boolean;
  context: TestContext;
  only?: boolean;
  /**
   * Per-test override for the number of retries on failure. When undefined,
   * the runner falls back to `runtimeConfig.retry`.
   */
  retry?: number;
  /**
   * Number of additional runs to perform on top of the first run; any failure
   * short-circuits remaining repeats. Currently per-test only.
   */
  repeats?: number;
  onFinished: OnTestFinishedHandler[];
  onFailed: OnTestFailedHandler[];
  /**
   * Store promises (from async expects) to wait for them before finishing the test
   */
  promises?: Promise<any>[];
  /**
   * Store stack trace error created when test is registered, used for trace original position
   */
  stackTraceError: Error;
  /**
   * Result of the task. if `expect.soft()` failed multiple times or `retry` was triggered.
   */
  result?: TaskResult;
};

export interface SuiteContext {
  filepath: TestPath;
}

export type AfterAllListener = (ctx: SuiteContext) => MaybePromise<void>;

export type BeforeAllListener = (
  ctx: SuiteContext,
) => MaybePromise<void | AfterAllListener>;

export type AfterEachListener = (ctx: TestContext) => MaybePromise<void>;

export type BeforeEachListener = (
  ctx: TestContext,
) => MaybePromise<void | AfterEachListener>;

export type TestSuiteInfo = {
  testId: string;
  name: string;
  parentNames?: string[];
  testPath: TestPath;
  project: string;
  type: 'suite';
  /** Only included when `includeTaskLocation` config is enabled */
  location?: Location;
  runMode: TestRunMode;
};

export type TestSuite = TestSuiteInfo & {
  each?: boolean;
  inTestEach?: boolean;
  concurrent?: boolean;
  sequential?: boolean;
  /**
   * Suite-level `TestOptions` passed to `describe(name, options, fn)`. Applied
   * as inheritable defaults to descendant cases: an explicit case-level value
   * wins, and a nested `describe` inherits its parent's value. Stored on the
   * suite only to propagate down — suites are not executed themselves.
   */
  timeout?: number;
  retry?: number;
  repeats?: number;
  /** nested cases and suite could in a suite */
  tests: Test[];
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

export type TestInfo = TestCaseInfo | (TestSuiteInfo & { tests: TestInfo[] });

export type TestFileInfo = {
  testId: string;
  testPath: TestPath;
  tests: TestInfo[];
};

export type Test = TestSuite | TestCase;

export type TestResultStatus = 'skip' | 'pass' | 'fail' | 'todo';

export type FormattedError = {
  fullStack?: boolean;
  message: string;
  name?: string;
  stack?: string;
  diff?: string;
  expected?: string;
  actual?: string;
  retryCount?: number;
};

export type TestResult = {
  testId: string;
  status: TestResultStatus;
  name: string;
  testPath: TestPath;
  parentNames?: string[];
  duration?: number;
  errors?: FormattedError[];
  retryErrors?: FormattedError[];
  retryCount?: number;
  project: string;
  heap?: number;
};

export type TestFileResult = TestResult & {
  results: TestResult[];
  snapshotResult?: SnapshotResult;
  coverage?: Record<string, FileCoverageData>;
  coverageRaw?: unknown;
  /**
   * Perfetto-compatible trace events. Stripped at the pool boundary.
   *
   * @internal
   */
  traceEvents?: import('../utils/trace').TraceEvent[];
};

export interface UserConsoleLog {
  content: string;
  name: string;
  taskId?: string;
  taskName?: string;
  taskParentNames?: string[];
  taskType?: 'file' | 'suite' | 'case';
  trace?: string;
  testPath: TestPath;
  type: ConsoleStreamType;
}
