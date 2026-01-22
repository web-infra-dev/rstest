import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { SnapshotSummary } from '@vitest/snapshot';
import type { BuiltInReporterNames } from '../core/rstest';
import type { Options as WindowRendererOptionsOptions } from '../reporter/windowedRenderer';
import type {
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestSuiteInfo,
  UserConsoleLog,
} from './testSuite';
import type { MaybePromise } from './utils';

export type Duration = {
  totalTime: number;
  buildTime: number;
  testTime: number;
};

export type { SourceMapInput, SnapshotSummary };

export type GetSourcemap = (
  sourcePath: string,
) => Promise<SourceMapInput | null>;

export type { BuiltInReporterNames };

export type DefaultReporterOptions = {
  /**
   * prints out summary of all tests
   * @default true
   */
  summary?: boolean;
  /**
   * logger which write messages to
   * @default process.stdout/process.stderr
   */
  logger?: WindowRendererOptionsOptions['logger'];

  /**
   * prints out project name in test file title
   * show project name by default when running multiple projects
   */
  showProjectName?: boolean;
};

export type VerboseReporterOptions = Omit<DefaultReporterOptions, 'summary'>;

type BuiltinReporterOptions = {
  default: DefaultReporterOptions;
  verbose: VerboseReporterOptions;
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
   * Called after tests in file collected.
   */
  onTestFileReady?: (test: TestFileInfo) => void;
  /**
   * Called when the test file has finished running.
   */
  onTestFileResult?: (test: TestFileResult) => void;
  /**
   * Called before running the test suite.
   */
  onTestSuiteStart?: (test: TestSuiteInfo) => void;
  /**
   * Called when the suite has finished running or was just skipped.
   *
   * `result.errors` contains only suite hooks errors
   */
  onTestSuiteResult?: (result: TestResult) => void;
  /**
   * Called when the test has finished running or was just skipped.
   */
  onTestCaseResult?: (result: TestResult) => void;
  /**
   * Called before running the test case.
   */
  onTestCaseStart?: (test: TestCaseInfo) => void;
  /**
   * Called before all tests start
   */
  onTestRunStart?: () => MaybePromise<void>;
  /**
   * Called after all tests have finished running.
   */
  onTestRunEnd?: ({
    results,
    testResults,
    duration,
    getSourcemap,
    snapshotSummary,
    unhandledErrors,
  }: {
    results: TestFileResult[];
    testResults: TestResult[];
    duration: Duration;
    getSourcemap: GetSourcemap;
    unhandledErrors?: Error[];
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
