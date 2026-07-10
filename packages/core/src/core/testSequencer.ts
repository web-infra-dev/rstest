/**
 * Perf-first test-file ordering. Pure and deterministic: given the same
 * entries and hints it always produces the same order, and it never mutates
 * its inputs. See `resultsCache.ts` for where hints come from.
 *
 * Ordering (descending priority):
 *   1. Files that failed on the last run go first (fail fast).
 *   2. Files with no cached duration ("new") go before known files, ordered by
 *      bundle `size` descending — heavier cold-start cost first.
 *   3. Known files by cached duration descending (Longest Processing Time),
 *      which minimizes worker tail idle for the FIFO pool.
 *   4. `testPath.localeCompare` as the final tie-break for full determinism.
 */

export type SequenceHint = { duration?: number; failed?: boolean };
export type SequenceHints = Map<string, SequenceHint>;

const EMPTY_HINT: SequenceHint = {};

export const sortTestEntries = <T extends { testPath: string; size?: number }>(
  entries: T[],
  hints: SequenceHints,
  getKey: (testPath: string) => string,
): T[] => {
  const decorated = entries.map((entry) => ({
    entry,
    hint: hints.get(getKey(entry.testPath)) ?? EMPTY_HINT,
  }));

  decorated.sort((a, b) => {
    const aFailed = a.hint.failed === true;
    const bFailed = b.hint.failed === true;
    if (aFailed !== bFailed) return aFailed ? -1 : 1;

    const aNew = a.hint.duration == null;
    const bNew = b.hint.duration == null;
    if (aNew !== bNew) return aNew ? -1 : 1;

    if (aNew) {
      const sizeDiff = (b.entry.size ?? 0) - (a.entry.size ?? 0);
      if (sizeDiff !== 0) return sizeDiff;
    } else {
      const durationDiff = b.hint.duration! - a.hint.duration!;
      if (durationDiff !== 0) return durationDiff;
    }

    return a.entry.testPath.localeCompare(b.entry.testPath);
  });

  return decorated.map((d) => d.entry);
};

/**
 * File-level `--onlyFailures` selection for a single project. Pure and
 * order-preserving: never mutates its inputs, and returns kept entries in their
 * original order (the perf-first `sortTestEntries` runs afterwards).
 *
 * Uses the same `hints`/`getKey` as the sequencer — the single source of truth
 * for a file's last-known failure state:
 *   - keep entries whose hint has `failed === true`;
 *   - drop entries whose hint is present but not failed (previously
 *     passed/skipped) and entries with no hint (never run / newly added) —
 *     matching Jest and pytest `--lf`.
 *
 * `covered` is `false` when NONE of the entries has a hint, i.e. the project is
 * absent from the results cache (e.g. a browser project whose results the cache
 * does not record). The caller uses this to fall back to running the whole
 * project rather than silently deselecting everything.
 */
export const filterFailedEntries = <T extends { testPath: string }>(
  entries: T[],
  hints: SequenceHints,
  getKey: (testPath: string) => string,
): { entries: T[]; covered: boolean } => {
  const failed: T[] = [];
  let covered = false;
  for (const entry of entries) {
    const hint = hints.get(getKey(entry.testPath));
    if (hint === undefined) {
      continue;
    }
    covered = true;
    if (hint.failed === true) {
      failed.push(entry);
    }
  }

  // When uncovered, `failed` is empty and unused — fall back to all entries.
  return { entries: covered ? failed : entries, covered };
};
