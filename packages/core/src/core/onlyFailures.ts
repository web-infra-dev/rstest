import { color, logger } from '../utils';
import { type ResultsCacheData, sequenceKey } from './resultsCache';
import { filterFailedEntries, type SequenceHints } from './testSequencer';

const NO_FAILURES_NOTICE =
  'No failed tests found from the previous run. Running all tests.';

/**
 * `--onlyFailures` file-level selection across all projects. Mutates each plan's
 * `finalEntries` in place to the set of files that should run, and emits the
 * user-facing notices. Extracted from `runTests` so that hot path holds only the
 * mode/scope guard and a single call site.
 *
 * Semantics (per-project rule lives in {@link filterFailedEntries}):
 *   - no results cache yet → keep everything and print the "no failures" notice;
 *   - a project absent from the cache → run all of its files (fallback) so it is
 *     never silently deselected, with a debug log;
 *   - nothing failed anywhere → keep everything and print the "no failures"
 *     notice (pytest's default, not Jest's "run nothing");
 *   - otherwise → narrow to the failed files and print the deselection summary.
 */
export const applyOnlyFailuresSelection = <E extends { testPath: string }>(
  projectPlans: {
    p: { name: string; environmentName: string };
    finalEntries: E[];
  }[],
  {
    resultsCache,
    sequenceHints,
    rootPath,
  }: {
    resultsCache: ResultsCacheData | undefined;
    sequenceHints: SequenceHints;
    rootPath: string;
  },
): void => {
  if (!resultsCache) {
    // No results cache yet (first-ever run, or the cache was cleared): there is
    // no failure history to filter on, so run everything with a notice.
    logger.log(color.gray(NO_FAILURES_NOTICE));
    return;
  }

  let candidateCount = 0;
  let selectedCount = 0;
  // Failures come only from cache-covered projects. An uncovered project's
  // fallback entries are "unknown", not "failed", so they must not count toward
  // the "did anything fail?" decision below — otherwise a clean multi-project
  // run that merely gained a new/uncovered project would skip the run-everything
  // path and silently deselect the clean covered projects.
  let failedCount = 0;
  const selections = projectPlans.map((plan) => {
    candidateCount += plan.finalEntries.length;
    const { entries: kept, covered } = filterFailedEntries(
      plan.finalEntries,
      sequenceHints,
      (testPath) => sequenceKey(plan.p.name, rootPath, testPath),
    );
    if (!covered && plan.finalEntries.length) {
      // The cache doesn't record this project (e.g. browser results are written
      // on a separate path). Run all of its files rather than silently
      // deselecting everything.
      logger.debug(
        color.yellow(
          `onlyFailures: project(${plan.p.name}) has no results in the sequence cache; running all its test files.`,
        ),
      );
    } else if (covered) {
      failedCount += kept.length;
    }
    selectedCount += kept.length;
    return kept;
  });

  if (failedCount === 0) {
    // Nothing failed on the previous run (every covered project is clean; any
    // uncovered project has no failure history): keep the full, unfiltered set —
    // pytest's default, not Jest's "run nothing".
    logger.log(color.gray(NO_FAILURES_NOTICE));
    return;
  }

  projectPlans.forEach((plan, index) => {
    plan.finalEntries = selections[index]!;
  });
  const deselected = candidateCount - selectedCount;
  if (deselected > 0) {
    logger.log(
      color.gray(
        `onlyFailures: running ${selectedCount} of ${candidateCount} test files (${deselected} deselected).`,
      ),
    );
  }
};
