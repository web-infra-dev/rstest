import type { SnapshotResult } from '@vitest/snapshot';

// TODO: Unify filePath、testPath、originPath、sourcePath
import type { MaybePromise } from './utils';

export type TestRunMode = 'run' | 'skip' | 'todo' | 'only';

export type TestCase = {
  filePath: string;
  name: string;
  fn?: () => void | Promise<void>;
  runMode: TestRunMode;
  timeout?: number;
  fails?: boolean;
  // TODO
  only?: boolean;
  // TODO
  onFinished?: any[];
  type: 'case';
  parentNames?: string[];
  /**
   * Store promises (from async expects) to wait for them before finishing the test
   */
  promises?: Promise<any>[];
};

export type SuiteContext = {
  filepath: string;
};

export type AfterAllListener = (ctx: SuiteContext) => MaybePromise<void>;
export type BeforeAllListener = (
  ctx: SuiteContext,
) => MaybePromise<void | AfterAllListener>;
export type AfterEachListener = () => MaybePromise<void>;
export type BeforeEachListener = () => MaybePromise<void | AfterEachListener>;

export type TestSuite = {
  name: string;
  parentNames?: string[];
  runMode: TestRunMode;
  // TODO
  filepath?: string;
  /** nested cases and suite could in a suite */
  tests: Array<TestSuite | TestCase>;
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
  filePath: string;
};

export type Test = TestSuite | TestCase;

export type TestResultStatus = 'skip' | 'pass' | 'fail' | 'todo';

export type TestError = {
  message: string;
  name?: string;
  stack?: string;
  diff?: string;
};

export type TestResult = {
  status: TestResultStatus;
  name: string;
  testPath: string;
  parentNames?: string[];
  duration?: number;
  errors?: TestError[];
};

export type TestFileResult = TestResult & {
  results: TestResult[];
  snapshotResult?: SnapshotResult;
};
