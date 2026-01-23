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

export type MdReporterOptions = {
  /**
   * Output detail level preset.
   * - `'normal'`: balanced output with code frames, repro commands, and candidate files
   * - `'compact'`: minimal output without code frames, candidate files, or full stack traces
   * - `'full'`: verbose output including console logs and environment info
   * @default 'normal'
   */
  preset?: 'normal' | 'compact' | 'full';

  /**
   * Header section controls.
   * - `false`: omit all header extras (runtime/env)
   * - `true`: include all default header extras
   * - object form: toggle individual parts
   * @default { env: true }
   */
  header?: boolean | { env?: boolean };

  /**
   * Reproduction command controls.
   * - `false`: omit reproduction commands
   * - `'file'`: only include the test file path
   * - `'file+name'`: include both file path and `--testNamePattern`
   * - `true`: same as `'file+name'`
   * @default 'file+name'
   */
  reproduction?: boolean | 'file' | 'file+name';

  /**
   * Failure output controls.
   * @default { max: 50, includeTruncatedList: true }
   */
  failures?: { max?: number; includeTruncatedList?: boolean };

  /**
   * Code frame controls.
   * - `false`: disable code frames
   * - `true`: enable with default line window
   * - object form: customize line window
   * @default { linesAbove: 2, linesBelow: 2 }
   */
  codeFrame?: boolean | { linesAbove?: number; linesBelow?: number };

  /**
   * Stack output controls.
   * - `false`: omit stack info
   * - `'top'`: include only the top frame
   * - `number`: include up to N stack frames
   * - `'full'`: include a large default number of stack frames
   */
  stack?: number | false | 'full' | 'top';

  /**
   * Candidate files controls (best-effort files extracted from stack traces).
   * - `false`: omit candidate files
   * - `true`: enable with defaults
   * - object form: customize max items
   * @default { max: 5 }
   */
  candidateFiles?: boolean | { max?: number };

  /**
   * Console output controls.
   * - `false`: omit console logs
   * - `true`: include console logs with defaults
   * - object form: customize limits
   */
  console?:
    | boolean
    | { maxLogsPerTestPath?: number; maxCharsPerEntry?: number };

  /**
   * Error section controls.
   * @default { unhandled: true }
   */
  errors?: boolean | { unhandled?: boolean };
};

type BuiltinReporterOptions = {
  default: DefaultReporterOptions;
  verbose: VerboseReporterOptions;
  md: MdReporterOptions;
  'github-actions': Record<string, unknown>;
  junit: Record<string, unknown>;
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
