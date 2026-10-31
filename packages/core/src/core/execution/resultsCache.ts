import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'pathe';
import type { TestFileResult } from '../../types';
import { logger, RESULTS_CACHE_DIR } from '../../utils';

/**
 * Persistent, best-effort record of each test file's last-known runtime and
 * failure state, used to order test files perf-first on the next run (see
 * `testSequencer.ts`) and to select failed files for `onlyFailures` (see
 * `onlyFailures.ts`). This is purely an optimization: every read/write path
 * swallows its own IO errors, so a missing, corrupt, or non-writable cache
 * degrades to a cold (size-only) ordering rather than failing the run.
 *
 * The cache lives in a dedicated directory (`RESULTS_CACHE_DIR`, a dotted
 * prefix) that cannot collide with the `rstest`/`rstest-<env>` Rspack build
 * cache — see the constant's definition for why the dot is load-bearing.
 */
const CACHE_FILE = 'results.json';
// Version 1 stored execution duration, which omitted module loading.
const CACHE_VERSION = 2;

/** Entries untouched for longer than this are pruned on write. */
const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * EWMA weight for the newest duration sample. The previous smoothed value
 * contributes `1 - DURATION_WEIGHT`, so ordering tracks real drift quickly
 * while still damping a single slow/fast outlier — unlike Vitest/Jest, which
 * only keep the last run's raw duration.
 */
const DURATION_WEIGHT = 0.7;

export type CachedFileResult = {
  /** EWMA-smoothed loading and execution duration in milliseconds. */
  duration?: number;
  /** Whether the last completed run of this file failed. */
  failed?: boolean;
  /** `Date.now()` of the last update; used for age-based pruning. */
  at: number;
};

export type ResultsCacheData = {
  version: number;
  files: Record<string, CachedFileResult>;
};

/**
 * Cache key = project name + NUL + posix path relative to `rootPath`. The
 * project prefix disambiguates the same relative path across multiple
 * projects; the NUL separator cannot appear in a path segment.
 */
export const sequenceKey = (
  project: string,
  rootPath: string,
  testPath: string,
): string => `${project}\0${relative(rootPath, testPath)}`;

const cachePath = (rootPath: string): string =>
  join(rootPath, RESULTS_CACHE_DIR, CACHE_FILE);

/**
 * Read the sequencing cache. Returns `undefined` on any failure — a missing
 * file, invalid JSON, or unsupported version all degrade to a cold start.
 */
export const readResultsCache = async (
  rootPath: string,
): Promise<ResultsCacheData | undefined> => {
  try {
    const content = await readFile(cachePath(rootPath), 'utf-8');
    const parsed = JSON.parse(content) as ResultsCacheData;
    if (
      !parsed ||
      (parsed.version !== 1 && parsed.version !== CACHE_VERSION) ||
      typeof parsed.files !== 'object' ||
      parsed.files === null
    ) {
      return undefined;
    }
    if (parsed.version === 1) {
      // Failure history still applies, but execution-only estimates must not
      // be mixed with loading + execution samples. Preserve ages for pruning.
      for (const entry of Object.values(parsed.files)) {
        delete entry.duration;
      }
      parsed.version = CACHE_VERSION;
    }
    return parsed;
  } catch {
    return undefined;
  }
};

/**
 * Merge this run's results into the on-disk cache and persist atomically.
 * Never throws — cache problems must not affect the test run.
 */
export const writeResultsCache = async (
  rootPath: string,
  results: TestFileResult[],
  deletedTestPaths: string[] = [],
): Promise<void> => {
  try {
    const now = Date.now();
    // Re-read and merge so concurrent processes writing sibling projects don't
    // clobber each other's entries (last writer wins per key, best-effort).
    const existing = await readResultsCache(rootPath);
    const files: Record<string, CachedFileResult> = { ...existing?.files };

    for (const result of results) {
      const key = sequenceKey(result.project, rootPath, result.testPath);
      const prev = files[key];

      // Every run that reached here executed the file, so always refresh its
      // fail state + timestamp: `fail` re-enters failed-first, while `pass`,
      // `skip`, and `todo` clear it (a quarantined file whose failing tests were
      // converted to skip/todo must stop stealing the front of the queue).
      //
      // Loading failures have loadDuration but no execution duration. Crashes
      // without either timing, and skip/todo results, preserve the old estimate.
      const isPassFail = result.status === 'pass' || result.status === 'fail';
      let duration = prev?.duration;
      if (
        isPassFail &&
        (result.duration != null || result.loadDuration != null)
      ) {
        const measuredDuration =
          (result.loadDuration ?? 0) + (result.duration ?? 0);
        duration =
          prev?.duration != null
            ? Math.round(
                measuredDuration * DURATION_WEIGHT +
                  prev.duration * (1 - DURATION_WEIGHT),
              )
            : measuredDuration;
      }

      files[key] = {
        duration,
        failed: result.status === 'fail',
        at: now,
      };
    }

    // Single O(N) prune sweep: drop deleted files (across all projects — the
    // file is gone, matched by the relative-path portion of the key) and stale
    // entries. Residual mismatched keys are harmless, this just bounds growth.
    const deletedRelPaths = new Set(
      deletedTestPaths.map((p) => relative(rootPath, p)),
    );
    for (const [key, entry] of Object.entries(files)) {
      const relPath = key.slice(key.indexOf('\0') + 1);
      if (deletedRelPaths.has(relPath) || now - entry.at > MAX_ENTRY_AGE_MS) {
        delete files[key];
      }
    }

    const data: ResultsCacheData = { version: CACHE_VERSION, files };
    const dir = join(rootPath, RESULTS_CACHE_DIR);
    await mkdir(dir, { recursive: true });
    // Atomic write: write to a pid-scoped temp file then rename into place so a
    // concurrent reader never observes a half-written JSON.
    const tmp = join(dir, `${CACHE_FILE}.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, cachePath(rootPath));
  } catch (error) {
    logger.debug(`Failed to write test sequence cache: ${error}`);
  }
};
