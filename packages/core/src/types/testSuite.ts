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

export type Test = TestSuite | TestCase;

export type TestResultStatus = 'skip' | 'pass' | 'fail' | 'todo';

export type TestSuiteResult = {
  status: TestResultStatus;
  name: string;
  prefix?: string;
};

export type TestResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
  results: TestSuiteResult[];
};
