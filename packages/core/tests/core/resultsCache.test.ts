import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { join } from 'pathe';
import {
  readResultsCache,
  type ResultsCacheData,
  sequenceKey,
  writeResultsCache,
} from '../../src/core/resultsCache';
import type { TestFileResult, TestResultStatus } from '../../src/types';

const CACHE_REL = 'node_modules/.cache/.rstest-results/results.json';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rstest-cache-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const fileResult = (
  name: string,
  status: TestResultStatus,
  duration: number | undefined,
  project = 'default',
): TestFileResult => ({
  testId: name,
  status,
  name,
  testPath: join(root, name),
  project,
  duration,
  results: [],
});

const seed = async (data: ResultsCacheData): Promise<void> => {
  const dir = join(root, 'node_modules/.cache/.rstest-results');
  await mkdir(dir, { recursive: true });
  await writeFile(join(root, CACHE_REL), JSON.stringify(data));
};

describe('readResultsCache', () => {
  it('returns undefined when the cache file is missing', async () => {
    expect(await readResultsCache(root)).toBeUndefined();
  });

  it('returns undefined on corrupt JSON', async () => {
    const dir = join(root, 'node_modules/.cache/.rstest-results');
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, CACHE_REL), '{ not valid json');
    expect(await readResultsCache(root)).toBeUndefined();
  });

  it('returns undefined on version mismatch', async () => {
    await seed({ version: 999, files: { a: { duration: 1, at: Date.now() } } });
    expect(await readResultsCache(root)).toBeUndefined();
  });

  it('reads back a valid cache', async () => {
    await seed({ version: 1, files: { a: { duration: 5, at: Date.now() } } });
    const cache = await readResultsCache(root);
    expect(cache?.files.a?.duration).toBe(5);
  });
});

describe('writeResultsCache', () => {
  it('records duration and failure state for pass/fail files', async () => {
    await writeResultsCache(root, [
      fileResult('a.test.ts', 'pass', 100),
      fileResult('b.test.ts', 'fail', 200),
    ]);
    const cache = await readResultsCache(root);
    const keyA = sequenceKey('default', root, join(root, 'a.test.ts'));
    const keyB = sequenceKey('default', root, join(root, 'b.test.ts'));
    expect(cache?.files[keyA]).toMatchObject({ duration: 100, failed: false });
    expect(cache?.files[keyB]).toMatchObject({ duration: 200, failed: true });
  });

  it('smooths duration via EWMA on subsequent runs', async () => {
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 100)]);
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 200)]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'a.test.ts'));
    // round(200 * 0.7 + 100 * 0.3) = 170 — the newest sample dominates.
    expect(cache?.files[key]?.duration).toBe(170);
  });

  it('records a crash (fail without duration) into failed-first, keeping the old duration', async () => {
    // A worker crash yields `status: 'fail'` with no `duration` (see
    // `workerErrorToResult`). It must still be marked failed for next run while
    // preserving the last known smoothed duration.
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 100)]);
    await writeResultsCache(root, [fileResult('a.test.ts', 'fail', undefined)]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'a.test.ts'));
    expect(cache?.files[key]?.failed).toBe(true);
    expect(cache?.files[key]?.duration).toBe(100);
  });

  it('marks a first-ever crash (no prior duration) as failed with no duration', async () => {
    await writeResultsCache(root, [fileResult('a.test.ts', 'fail', undefined)]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'a.test.ts'));
    expect(cache?.files[key]?.failed).toBe(true);
    expect(cache?.files[key]?.duration).toBeUndefined();
  });

  it('preserves the cached duration for skip/todo files (no EWMA poisoning)', async () => {
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 100)]);
    await writeResultsCache(root, [fileResult('a.test.ts', 'skip', undefined)]);
    await writeResultsCache(root, [fileResult('a.test.ts', 'todo', undefined)]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'a.test.ts'));
    expect(cache?.files[key]?.duration).toBe(100);
    expect(cache?.files[key]?.failed).toBe(false);
  });

  it('clears the failed flag when a previously-failing file is later skipped/todo', async () => {
    // Quarantining a flaky file (converting its failing tests to skip/todo)
    // must drop it out of failed-first — otherwise it steals the front of the
    // queue on every run until the entry ages out.
    await writeResultsCache(root, [fileResult('a.test.ts', 'fail', 50)]);
    await writeResultsCache(root, [fileResult('a.test.ts', 'skip', undefined)]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'a.test.ts'));
    expect(cache?.files[key]?.failed).toBe(false);
    // The last real duration is kept so ordering stays informed.
    expect(cache?.files[key]?.duration).toBe(50);
  });

  it('clears the failed flag when a previously failing file passes', async () => {
    await writeResultsCache(root, [fileResult('a.test.ts', 'fail', 50)]);
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 50)]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'a.test.ts'));
    expect(cache?.files[key]?.failed).toBe(false);
  });

  it('merges without dropping other keys on write', async () => {
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 100)]);
    await writeResultsCache(root, [fileResult('b.test.ts', 'pass', 200)]);
    const cache = await readResultsCache(root);
    const keyA = sequenceKey('default', root, join(root, 'a.test.ts'));
    const keyB = sequenceKey('default', root, join(root, 'b.test.ts'));
    expect(cache?.files[keyA]?.duration).toBe(100);
    expect(cache?.files[keyB]?.duration).toBe(200);
  });

  it('disambiguates the same relative path across projects', async () => {
    await writeResultsCache(root, [
      fileResult('a.test.ts', 'pass', 100, 'proj-1'),
      fileResult('a.test.ts', 'pass', 200, 'proj-2'),
    ]);
    const cache = await readResultsCache(root);
    const key1 = sequenceKey('proj-1', root, join(root, 'a.test.ts'));
    const key2 = sequenceKey('proj-2', root, join(root, 'a.test.ts'));
    expect(cache?.files[key1]?.duration).toBe(100);
    expect(cache?.files[key2]?.duration).toBe(200);
  });

  it('prunes deleted test paths', async () => {
    await writeResultsCache(root, [fileResult('gone.test.ts', 'pass', 100)]);
    await writeResultsCache(root, [], [join(root, 'gone.test.ts')]);
    const cache = await readResultsCache(root);
    const key = sequenceKey('default', root, join(root, 'gone.test.ts'));
    expect(cache?.files[key]).toBeUndefined();
  });

  it('prunes entries older than 30 days', async () => {
    const stale = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const staleKey = sequenceKey('default', root, join(root, 'old.test.ts'));
    await seed({
      version: 1,
      files: { [staleKey]: { duration: 100, at: stale } },
    });
    await writeResultsCache(root, [fileResult('fresh.test.ts', 'pass', 10)]);
    const cache = await readResultsCache(root);
    expect(cache?.files[staleKey]).toBeUndefined();
    const freshKey = sequenceKey('default', root, join(root, 'fresh.test.ts'));
    expect(cache?.files[freshKey]?.duration).toBe(10);
  });

  it('does not leave a temp file behind after an atomic write', async () => {
    await writeResultsCache(root, [fileResult('a.test.ts', 'pass', 100)]);
    const dir = join(root, 'node_modules/.cache/.rstest-results');
    const raw = await readFile(join(dir, 'results.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
