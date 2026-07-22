import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { ProjectContext } from './core';
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
   * The explicit browser-project subset the executor was constructed with (plan
   * output). The host keeps a stable reference to this instead of re-deriving
   * `browser.enabled` projects from `context.projects` (which planning mutates).
   */
  projects?: ProjectContext[];
  /**
   * Pre-calculated sharded entries for browser projects.
   * If provided, the browser controller will use these instead of collecting its own.
   * Key is project environmentName.
   */
  shardedEntries?: Map<string, { entries: Record<string, string> }>;
  /**
   * Treat the provided sharded entries as the authoritative core run plan.
   * Mixed node+browser runs set this so Browser Mode does not recompute a
   * different global shard after config hooks have run.
   */
  freezeShardedEntries?: boolean;
  /**
   * Only initialize Browser Mode config hooks and refresh test files, without
   * launching the browser provider to collect test declarations.
   */
  filesOnly?: boolean;
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
   * Browser project environments whose `modifyRstestConfig` hooks already
   * applied this run. Shared across the discovery boot and the real run so
   * hooks stay single-shot.
   */
  appliedModifyRstestConfigEnvironments?: Set<string>;
  /**
   * When set, the browser host emits Perfetto trace events to this callback
   * (per-file `tests` slices + suite/case slices). Only invoked when the
   * caller has `--trace` enabled.
   */
  onTraceEvents?: (events: TraceEvent[]) => void;
  /**
   * Post-globalSetup env change-set from the core pre-cycle stage. The host
   * merges it into the browser runtime env store between the static base
   * (`NODE_ENV`/`RSTEST`) and the user `test.env` config.
   */
  env?: Record<string, string | undefined>;
  /**
   * The cycle's snapshot update state (`ExecutorRunCycleOptions.updateSnapshot`
   * carrier). The host falls back to reading
   * `context.snapshotManager.options` when absent (watch startup path).
   */
  updateSnapshot?: SnapshotUpdateState;
}

/**
 * Options for collecting browser tests without running them (`rstest list` and
 * `TestExecutor.collect`). Single definition for the core↔browser boundary —
 * the `@rstest/browser` public wrapper and the host implementation share it.
 */
export type ListBrowserTestsOptions = Pick<
  BrowserTestRunOptions,
  | 'shardedEntries'
  | 'freezeShardedEntries'
  | 'filesOnly'
  | 'projects'
  | 'appliedModifyRstestConfigEnvironments'
>;

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
  /**
   * Watch-session handles, present only on watch-mode results (returned after
   * the initial run while the session keeps running). Core's CLI shortcuts
   * drive the host's rerun transport through them — the host itself never
   * subscribes to stdin.
   */
  watch?: BrowserWatchHandles;
}

/** Watch-session control surface exposed to core (CLI shortcuts, restart). */
export interface BrowserWatchHandles {
  /**
   * Rerun the given test paths through the host's watch rerun pipeline
   * (all current test files when omitted). Resolves when the rerun has
   * completed, so callers may restore toggled state afterwards.
   */
  rerun: (testPaths?: string[]) => Promise<void>;
  /** Tear down the watch session (dev servers, provider, browser). */
  close: () => Promise<void>;
}
