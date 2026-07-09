import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative } from 'pathe';
import type { TestFileResult } from '../types';
import { logger } from '../utils';

/**
 * Persistent, best-effort record of each test file's last-known runtime and
 * failure state, used to order test files perf-first on the next run (see
 * `testSequencer.ts`). This is purely an optimization: every read/write path
 * swallows its own IO errors, so a missing, corrupt, or non-writable cache
 * degrades to a cold (size-only) ordering rather than failing the run.
 *
 * The file lives under a dedicated directory (`.rstest-sequence`, leading dot)
 * so it can never collide with the `rstest`/`rstest-<env>` Rspack build cache.
 */
const CACHE_DIR = 'node_modules/.cache/.rstest-sequence';
const CACHE_FILE = 'results.json';
const CACHE_VERSION = 1;

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
  /** EWMA-smoothed duration in ms. Absent until the file has run at least once. */
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
  join(rootPath, CACHE_DIR, CACHE_FILE);

/**
 * Read the sequencing cache. Returns `undefined` on any failure — a missing
 * file, invalid JSON, or version mismatch all degrade to a cold start.
 */
export const readResultsCache = async (
  rootPath: string,
): Promise<ResultsCacheData | undefined> => {
  try {
    const content = await readFile(cachePath(rootPath), 'utf-8');
    const parsed = JSON.parse(content) as ResultsCacheData;
    if (
      !parsed ||
      parsed.version !== CACHE_VERSION ||
      typeof parsed.files !== 'object' ||
      parsed.files === null
    ) {
      return undefined;
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
      // `skip`/`todo` files carry no meaningful duration and would poison the
      // EWMA with a near-zero sample; leave any existing record untouched. The
      // `failed` flag persists until the file actually re-runs to pass/fail.
      if (result.status !== 'pass' && result.status !== 'fail') {
        continue;
      }

      const key = sequenceKey(result.project, rootPath, result.testPath);
      const prev = files[key];

      // Always refresh the fail state + timestamp for a completed run. A worker
      // crash yields a `fail` result with no `duration` (see
      // `workerErrorToResult`); it must still land in failed-first next run, so
      // only the EWMA update is skipped when the duration is missing — the old
      // smoothed duration is preserved.
      let duration = prev?.duration;
      if (result.duration != null) {
        duration =
          prev?.duration != null
            ? Math.round(
                result.duration * DURATION_WEIGHT +
                  prev.duration * (1 - DURATION_WEIGHT),
              )
            : result.duration;
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
    const dir = join(rootPath, CACHE_DIR);
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
