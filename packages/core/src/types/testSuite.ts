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

type ActiveTimeoutContext = {
  /** @internal Active hook or fixture deadline. */
  activeTimeout?: number;
  /** @internal Start time for the active hook or fixture deadline. */
  activeTimeoutStartTime?: number;
};

export type TaskMetaValue =
  | string
  | number
  | boolean
  | null
  | TaskMetaValue[]
  | { [key: string]: TaskMetaValue };

export type TaskMeta = Record<string, TaskMetaValue>;

// Mirrors @vitest/expect's TaskResult.state literals, deliberately not the public TestResultStatus.
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
  errors?: SerializedError[];
}

export type Location = {
  line: number;
  column: number;
};

export type RawTestCaseInfo = {
  testId: string;
  testPath: TestPath;
  name: string;
  timeout?: number;
  parentNames?: string[];
  project: string;
  startTime?: number;
  /** Only included when `includeTaskLocation` config is enabled */
  location?: Location;
  /** Best-effort: semantics may change independently of the stable reporter contract. */
  meta?: TaskMeta;
  type: 'case';
  runMode: TestRunMode;
};

export type TestCaseInfo = RawTestCaseInfo & {
  fullName: string;
  relativeTestPath: string;
};

export type TestCase = RawTestCaseInfo & {
  originalFn?: (context: TestContext) => void | Promise<void>;
  fn?: (context: TestContext) => void | Promise<void>;
  fails?: boolean;
  each?: boolean;
  fixtures?: NormalizedFixtures;
  concurrent?: boolean;
  /** @internal True when the case is nested in a concurrently running suite. */
  inConcurrentScope?: boolean;
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
} & ActiveTimeoutContext;

export interface SuiteContext {
  filepath: TestPath;
  meta: TaskMeta;
}

export type AfterAllListener = (ctx: SuiteContext) => MaybePromise<void>;

export type BeforeAllListener = (
  ctx: SuiteContext,
) => MaybePromise<void | AfterAllListener>;

export type AfterEachListener<ExtraContext = object> = (
  ctx: TestContext & ExtraContext,
) => MaybePromise<void>;

export type BeforeEachListener<ExtraContext = object> = (
  ctx: TestContext & ExtraContext,
) => MaybePromise<void | AfterEachListener<ExtraContext>>;

export type RawTestSuiteInfo = {
  testId: string;
  name: string;
  parentNames?: string[];
  testPath: TestPath;
  project: string;
  type: 'suite';
  /** Only included when `includeTaskLocation` config is enabled */
  location?: Location;
  /** Best-effort: semantics may change independently of the stable reporter contract. */
  meta?: TaskMeta;
  runMode: TestRunMode;
};

export type TestSuiteInfo = RawTestSuiteInfo & {
  fullName: string;
  relativeTestPath: string;
};

export type TestSuite = RawTestSuiteInfo & {
  /** @internal */
  hasRunnableTests?: boolean;
  each?: boolean;
  inTestEach?: boolean;
  concurrent?: boolean;
  /** @internal True when the suite is nested in a concurrently running suite. */
  inConcurrentScope?: boolean;
  sequential?: boolean;
  /**
   * Suite-level `TestOptions` passed to `describe(name, options, fn)`. Applied
   * as inheritable defaults to descendant suites and cases: an explicit child
   * value wins, and a nested `describe` carries inherited values to its own
   * descendants.
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
} & ActiveTimeoutContext;

export type TestSuiteListeners = keyof Pick<
  TestSuite,
  | 'afterAllListeners'
  | 'beforeAllListeners'
  | 'afterEachListeners'
  | 'beforeEachListeners'
>;

export type RawTestInfo =
  RawTestCaseInfo | (RawTestSuiteInfo & { tests: RawTestInfo[] });

export type TestInfo = TestCaseInfo | (TestSuiteInfo & { tests: TestInfo[] });

export type RawTestFileInfo<Info extends RawTestInfo = RawTestInfo> = {
  testId: string;
  testPath: TestPath;
  project: string;
  tests: Info[];
};

export type TestFileInfo = RawTestFileInfo<TestInfo> & {
  relativeTestPath: string;
};

export type Test = TestSuite | TestCase;

export type TestResultStatus = 'skipped' | 'passed' | 'failed' | 'todo';

export interface SerializedError {
  fullStack?: boolean;
  message: string;
  name?: string;
  stack?: string;
  diff?: string;
  expected?: string;
  actual?: string;
  retryCount?: number;
}

export type RawTestResult = {
  testId: string;
  status: TestResultStatus;
  name: string;
  testPath: TestPath;
  parentNames?: string[];
  duration?: number;
  errors?: SerializedError[];
  retryErrors?: SerializedError[];
  retryCount?: number;
  project: string;
  /** Best-effort: semantics may change independently of the stable reporter contract. */
  meta?: TaskMeta;
  /** Best-effort: semantics may change independently of the stable reporter contract. */
  heap?: number;
};

export type TestResult = RawTestResult & {
  fullName: string;
  relativeTestPath: string;
};

export type TestFileSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  flaky: number;
};

export type RawTestFileResult<Result extends RawTestResult = RawTestResult> =
  RawTestResult & {
    results: Result[];
    snapshotResult?: SnapshotResult;
    /** Best-effort: semantics may change independently of the stable reporter contract. */
    coverage?: Record<string, FileCoverageData>;
    /**
     * Raw coverage payload used internally between workers and the pool.
     * Stripped at the pool boundary before results are exposed to reporters.
     *
     * @internal
     */
    coverageRaw?: unknown;
    /**
     * Perfetto-compatible trace events. Stripped at the pool boundary.
     *
     * @internal
     */
    traceEvents?: import('../utils/trace').TraceEvent[];
  };

export type TestFileResult = RawTestFileResult<TestResult> &
  TestResult & {
    summary: TestFileSummary;
  };

export interface RawUserConsoleLog {
  content: string;
  name: string;
  taskId?: string;
  taskName?: string;
  taskParentNames?: string[];
  taskType?: 'file' | 'suite' | 'case';
  trace?: string;
  testPath: TestPath;
  /**
   * Owning project. A test path alone does not identify the emitter once
   * several projects run the same file, and consumers that attribute output to
   * a file (the blob reporter's replay track, the browser host's sink routing)
   * cannot recover it from the other fields.
   */
  project: string;
  type: ConsoleStreamType;
}

export type UserConsoleLog = RawUserConsoleLog & { relativeTestPath: string };
