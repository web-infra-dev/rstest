import type { TestSuiteResult } from './testSuite';

export type RunnerHooks = {
  onTestEnd?: (result: TestSuiteResult) => Promise<void>;
};
