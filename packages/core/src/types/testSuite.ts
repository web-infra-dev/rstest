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

export type TestSuiteResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
};

export type TestResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
  results: TestSuiteResult[];
};
