import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { GetSourcemap } from './reporter';
import type { TestFileResult, TestResult } from './testSuite';
import type { TraceEvent } from '../utils/trace';

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
  /**
   * Keep watch infrastructure alive even when the initial browser test set is empty.
   */
  allowEmptyWatchRun?: boolean;
  /**
   * Treat an empty browser result as a no-op instead of a run failure.
   * Used by mixed node+browser planning, where Browser Mode hooks may add
   * entries after the node-side plan initially saw an empty browser project.
   */
  allowEmptyRun?: boolean;
  /**
   * When set, the browser host emits Perfetto trace events to this callback
   * (per-file `tests` slices + suite/case slices). Only invoked when the
   * caller has `--trace` enabled.
   */
  onTraceEvents?: (events: TraceEvent[]) => void;
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
