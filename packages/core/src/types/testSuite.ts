import type { SnapshotResult } from '@vitest/snapshot';

// TODO: Unify filePath、testPath、originPath、sourcePath
import type { MaybePromise } from './utils';

export type TestCase = {
  filePath: string;
  name: string;
  fn: () => void | Promise<void>;
  skipped?: boolean;
  todo?: boolean;
  fails?: boolean;
  // TODO
  only?: boolean;
  // TODO
  onFinished?: any[];
  type: 'case';
  prefixes?: string[];
  /**
   * Store promises (from async expects) to wait for them before finishing the test
   */
  promises?: Promise<any>[];
};

export type AfterAllListener = () => MaybePromise<void>;

export type TestSuite = {
  name: string;
  // TODO
  filepath?: string;
  /** nested cases and suite could in a suite */
  tests: Array<TestSuite | TestCase>;
  type: 'suite';
  afterAllListeners?: AfterAllListener[];
};

export type TestSuiteListeners = keyof Pick<TestSuite, 'afterAllListeners'>;

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
  prefixes?: string[];
  duration?: number;
  errors?: TestError[];
};

export type TestFileResult = TestResult & {
  results: TestResult[];
  snapshotResult?: SnapshotResult;
};
