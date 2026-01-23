import type { Reporter, TestResult } from '@rstest/core';

export type { Reporter, TestFileResult, TestResult } from '@rstest/core';

export type TestRunEndContext = Parameters<
  NonNullable<Reporter['onTestRunEnd']>
>[0];

export type Duration = TestRunEndContext['duration'];
export type GetSourcemap = TestRunEndContext['getSourcemap'];
export type SnapshotSummary = TestRunEndContext['snapshotSummary'];
export type FormattedError = NonNullable<TestResult['errors']>[number];
export type UserConsoleLog = Parameters<
  NonNullable<Reporter['onUserConsoleLog']>
>[0];

export type AgentMdReporterOptions = {
  preset?: 'normal' | 'compact' | 'full';
  includeEnv?: boolean;
  includeSnapshotSummary?: boolean;
  includeRepro?: boolean;
  reproMode?: 'file' | 'file+name';
  includeUnhandledErrors?: boolean;
  maxFailures?: number;
  includeFailureListWhenTruncated?: boolean;
  includeCodeFrame?: boolean;
  codeFrameLinesAbove?: number;
  codeFrameLinesBelow?: number;
  includeFullStackFrames?: boolean;
  maxStackFrames?: number;
  includeCandidateFiles?: boolean;
  maxCandidateFiles?: number;
  includeConsole?: boolean;
  maxConsoleLogsPerTestPath?: number;
  maxConsoleCharsPerEntry?: number;
  stripAnsi?: boolean;
};
