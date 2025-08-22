import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { SnapshotSummary } from '@vitest/snapshot';
import type { BuiltInReporterNames } from '../core/rstest';
import type {
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from './testSuite';
import type { MaybePromise } from './utils';

export type Duration = {
  totalTime: number;
  buildTime: number;
  testTime: number;
};

export type { SourceMapInput, SnapshotSummary };

export type GetSourcemap = (sourcePath: string) => SourceMapInput | null;

export type { BuiltInReporterNames };

export type DefaultReporterOptions = {
  /**
   * prints out summary of all tests
   * @default true
   */
  summary?: boolean;
};

type BuiltinReporterOptions = {
  default: DefaultReporterOptions;
};

export type ReporterWithOptions<
  Name extends BuiltInReporterNames = BuiltInReporterNames,
> = Name extends keyof BuiltinReporterOptions
  ? [Name, Partial<BuiltinReporterOptions[Name]>]
  : [Name, Record<string, unknown>];

export interface Reporter {
  /**
   * Called before test file run.
   */
  onTestFileStart?: (test: TestFileInfo) => void;
  /**
   * Called when the test file has finished running.
   */
  onTestFileResult?: (test: TestFileResult) => void;
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
    snapshotSummary,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    getSourcemap: GetSourcemap;
    snapshotSummary: SnapshotSummary;
    filterRerunTestPaths?: string[];
  }) => MaybePromise<void>;

  /**
   * Called when console log is calling.
   */
  onUserConsoleLog?: (log: UserConsoleLog) => void;

  /**
   * Called when rstest exit abnormally
   */
  onExit?: () => void;
}
