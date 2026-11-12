import type {
  ExecutorCycleOutcome,
  ExecutorRunCycleOptions,
} from '@rstest/core/internal/browser';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { getHeadlessConcurrency } from './concurrency';
import type { BrowserDispatchRequest, BrowserProjectRuntime } from './protocol';
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
  runCycle: (
    testPaths: string[],
    updateSnapshot: SnapshotUpdateState,
    onSelected?: ExecutorRunCycleOptions['onSelected'],
  ) => Promise<ExecutorCycleOutcome>;
  /** Explicit path-scoped rerun request (a CLI shortcut's browser fanout). */
  requestRerun: (
    testPaths?: string[],
    updateSnapshot?: SnapshotUpdateState,
  ) => Promise<void>;
};

export type BrowserV8CoverageRuntime = {
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
  runId?: string,
) => {
  runnerPage?: BrowserProviderPage;
  containerPage?: BrowserProviderPage;
  isRunCurrent?: () => boolean;
};

/**
 * The dispatch lanes a run's schedulers install, keyed by request shape: a
 * session target shot resolves in the headless lane's registry, a runId-named
 * shot resolves in the headed container lane. No cross-lane fallback — a
 * request that misses its own lane produces `{}` and the dispatch layer's
 * existing errors surface instead.
 */
export type DispatchLanes = {
  headless?: DispatchPageResolver;
  headed?: DispatchPageResolver;
};

/**
 * One `(project, browserName, testPath)` scheduling unit: plan-level files are
 * keyed by `(project, testPath)`, and the browser dimension is added once per
 * scheduling boundary so every consumer — page batches, sessions, page
 * options, coverage guards — sees the full unit and reads the row's
 * runtime-effective fields off it instead of a per-key side map.
 */
export type ScheduledTestFile = {
  testPath: string;
  projectName: string;
  row: BrowserProjectRuntime;
};

/**
 * Group rows by project name — the lookup `expandToRows` consumes. Lanes call
 * it with their own row subset so each lane expands against the rows it owns.
 */
export const groupRowsByProject = (
  rows: readonly BrowserProjectRuntime[],
): Map<string, BrowserProjectRuntime[]> => {
  const rowsByProject = new Map<string, BrowserProjectRuntime[]>();
  for (const row of rows) {
    const group = rowsByProject.get(row.name) ?? [];
    group.push(row);
    rowsByProject.set(row.name, group);
  }
  return rowsByProject;
};

const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Build the scheduling queue as `(project, browser)` row groups: the files of
 * each row come in plan order, and whole rows follow each other. The batch
 * loop needs same-row files consecutive (a non-isolated page reuses its
 * fixtures per row), so interleaving browsers — flatMap's natural file-major
 * order — would make every batch a single file. Concurrency keeps this fair
 * (workers drain from one queue), so grouping is a scheduling-order change,
 * not a serialization.
 */
export const expandToRows = (
  files: readonly {
    testPath: string;
    projectName: string;
  }[],
  rowsByProject: ReadonlyMap<string, BrowserProjectRuntime[]>,
): ScheduledTestFile[] => {
  const expanded = files
    .flatMap((file) =>
      (rowsByProject.get(file.projectName) ?? []).map((row) => ({
        testPath: file.testPath,
        projectName: file.projectName,
        row,
      })),
    )
    .sort(
      (a, b) =>
        compareStrings(a.row.name, b.row.name) ||
        compareStrings(a.row.browserName, b.row.browserName),
    );
  // Pack by launch: runs of one browser stay consecutive, so a capped pool
  // finishes a browser before moving to the next instead of reopening it.
  // `sort` is stable, so rows keep the order above inside a launch.
  const launchOrder = new Map<string, number>();
  for (const { row } of expanded) {
    if (!launchOrder.has(row.launchKey)) {
      launchOrder.set(row.launchKey, launchOrder.size);
    }
  }
  return expanded.sort(
    (a, b) =>
      launchOrder.get(a.row.launchKey)! - launchOrder.get(b.row.launchKey)!,
  );
};

/**
 * The shared file budget of a mixed run: `pool.maxWorkers` (or the headless
 * default) clamped by the runs actually scheduled — `file x row` on the
 * headless lane (the same expansion its queue uses) plus the headed lane's
 * runs — so one file fanned out over several rows is not clamped to one slot.
 */
export const getMixedLaneConcurrency = (
  context: Parameters<typeof getHeadlessConcurrency>[0],
  lanes: {
    headlessFiles: readonly { testPath: string; projectName: string }[];
    headlessRows: readonly BrowserProjectRuntime[];
    headedFiles: readonly { testPath: string; projectName: string }[];
    headedRow: BrowserProjectRuntime;
  },
): number =>
  getHeadlessConcurrency(
    context,
    expandToRows(lanes.headlessFiles, groupRowsByProject(lanes.headlessRows))
      .length +
      expandToRows(lanes.headedFiles, groupRowsByProject([lanes.headedRow]))
        .length,
  );
