export type TestCase = {
  description: string;
  fn: () => void | Promise<void>;
  skipped?: boolean;
  todo?: boolean;
  fails?: boolean;
  // TODO
  only?: boolean;
  // TODO
  onFinished?: any[];
  type: 'case';
};

export type TestSuite = {
  description: string;
  // TODO
  filepath?: string;
  tests: Array<TestSuite | TestCase>;
  type: 'suite';
};

export type TestFileInfo = {
  filePath: string;
};

export type Test = TestSuite | TestCase;

export type TestResultStatus = 'skip' | 'pass' | 'fail' | 'todo';

type TestError = {
  message: string;
  name?: string;
  stack?: string;
};

export type TestResult = {
  status: TestResultStatus;
  name: string;
  testPath: string;
  prefix?: string;
  duration?: number;
  errors?: TestError[];
};

// TODO: rename to TestFileResult
export type TestSummaryResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
  results: TestResult[];
  duration?: number;
  testPath: string;
};
