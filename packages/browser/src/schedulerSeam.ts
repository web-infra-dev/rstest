import type { ExecutorCycleOutcome } from '@rstest/core/internal/browser';
import type { BrowserDispatchRequest } from './protocol';
import type { BrowserProviderPage } from './providers';

/**
 * The contract between the controller and whichever run branch executes a run.
 * It lives outside both so the schedulers never reach back into the controller
 * for a type: the controller owns the run's shape, the schedulers own the run.
 */

/**
 * The watch-session control surface a watch-mode controller run hands back with
 * its initial cycle. Every rerun trigger the host owns (dev rebuild, HMR, the
 * in-page rerun button) resolves its own scope and then signals core's
 * invalidation subscriber; core resets the cycle state and calls back into
 * {@link BrowserWatchSession.runCycle} to execute it. A trigger that resolves to
 * no work never signals, so a scope matching none of this host's files produces
 * no cycle and no cycle output.
 */
export type BrowserWatchSession = {
  /** Execute the scope the last trigger resolved, as one cycle outcome. */
  runCycle: (testPaths: string[]) => Promise<ExecutorCycleOutcome>;
  /** Explicit path-scoped rerun request (a CLI shortcut's browser fanout). */
  requestRerun: (testPaths?: string[]) => Promise<void>;
};

export type SchedulerCycleResult = {
  rawCoverage: unknown[];
  error?: Error;
};

export type CreateBrowserWatchSession = (
  execute: (testPaths: string[]) => Promise<SchedulerCycleResult>,
) => BrowserWatchSession;

export type BrowserV8CoverageRuntime = {
  resetResources: () => void;
  start: (page: BrowserProviderPage) => Promise<void>;
  take: (
    page: BrowserProviderPage,
    projectRoot: string,
    projectName?: string,
  ) => Promise<unknown | null>;
};

/**
 * What a run branch produces. Results and errors accumulate in the sinks the
 * controller owns, so a scheduler reports only what it alone knows: how long
 * the tests took, the session it left behind, and how to tear down a runtime
 * that does not outlive the run.
 */
export type SchedulerRunResult = {
  testTime: number;
  rawCoverage?: unknown[];
  watchSession?: BrowserWatchSession;
  close?: () => Promise<void>;
};

/**
 * How the shared dispatch layer reaches the pages of whichever run branch is
 * live. Only the running branch knows its pages, so it installs the resolver
 * and the dispatch layer stays branch-agnostic.
 */
export type DispatchPageResolver = (
  target?: BrowserDispatchRequest['target'],
) => {
  runnerPage?: BrowserProviderPage;
  containerPage?: BrowserProviderPage;
};
