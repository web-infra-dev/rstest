import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { GetSourcemap } from './reporter';
import type { TestFileResult, TestResult } from './testSuite';

export interface BrowserSourcemapResolutionResult {
  handled: boolean;
  sourcemap: SourceMapInput | null;
}

export type ResolveBrowserSourcemap = (
  sourcePath: string,
) => Promise<BrowserSourcemapResolutionResult>;

/**
 * Options for running browser tests.
 */
export interface BrowserTestRunOptions {
  /**
   * If true, browser mode will not call onTestRunEnd reporter hook.
   * This allows the caller to unify reporter output with node mode tests.
   */
  skipOnTestRunEnd?: boolean;
  /**
   * Pre-calculated sharded entries for browser projects.
   * If provided, the browser controller will use these instead of collecting its own.
   * Key is project environmentName.
   */
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
}

/**
 * Result from running browser tests.
 */
export interface BrowserTestRunResult {
  /** Test file results */
  results: TestFileResult[];
  /** Individual test case results */
  testResults: TestResult[];
  /** Duration information */
  duration: {
    totalTime: number;
    buildTime: number;
    testTime: number;
  };
  /** Whether the test run had failures */
  hasFailure: boolean;
  /** Errors that occurred before/outside test execution (e.g., browser launch failure) */
  unhandledErrors?: Error[];
  /** Source map resolver used when reporter output is unified in core */
  getSourcemap?: GetSourcemap;
  /** Route-aware source map resolver used by core unified reporter flow */
  resolveSourcemap?: ResolveBrowserSourcemap;
  /** Deferred cleanup hook for unified reporter mode */
  close?: () => Promise<void>;
}
