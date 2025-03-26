import type { TestResult } from './testSuite';

export type RunnerHooks = {
  onTestEnd?: (result: TestResult) => Promise<void>;
};
