export type TestCase = {
  description: string;
  fn: () => void | Promise<void>;
  skipped?: boolean;
  todo?: boolean;
  fails?: boolean;
};

export type TestSuite = {
  description: string;
  tests: TestCase[];
};

export type TestSuiteResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
};

export type TestResult = {
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
  results: TestSuiteResult[];
};
