import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { TestFileInfo, TestResult, TestSummaryResult } from './testSuite';
import type { MaybePromise } from './utils';

export type Duration = {
  totalTime: number;
  buildTime: number;
  testTime: number;
};

export type { SourceMapInput };

export type GetSourcemap = (
  sourcePath: string,
) => Promise<SourceMapInput | null>;
export interface Reporter {
  /**
   * Called before test file run.
   */
  onTestFileStart?: (test: TestFileInfo) => void;
  /**
   * Called when the test has finished running or was just skipped.
   */
  onTestCaseResult?: (result: TestResult) => void;
  /**
   * Called after all tests have finished running.
   */
  onTestRunEnd?: ({
    results,
    testResults,
    duration,
    getSourcemap,
  }: {
    results: TestSummaryResult[];
    testResults: TestResult[];
    duration: Duration;
    getSourcemap: GetSourcemap;
  }) => MaybePromise<void>;
}
