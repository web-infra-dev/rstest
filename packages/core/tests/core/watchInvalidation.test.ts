import type { Rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { withDefaultConfig } from '../../src/config';
import {
  applyRstestWatchIgnored,
  applyWatchInvalidation,
  type EntryHashSnapshot,
  type WatchInvalidationState,
} from '../../src/core/watch/watchInvalidation';

it('combines a watch predicate with Rstest output, snapshot and extra ignores', () => {
  const config = withDefaultConfig({ root: '/project' });
  config.output.distPath.root = 'dist/.rstest-temp';
  config.coverage.reportsDirectory = '/project/(app)/coverage';
  const rspackConfig: Rspack.Configuration = {
    watchOptions: { ignored: (file) => file === 'src\\ignored.ts' },
  };
  applyRstestWatchIgnored(rspackConfig, config, ['/project/[tests]/config.ts']);
  const ignored = rspackConfig.watchOptions?.ignored;
  expect(typeof ignored).toBe('function');
  if (typeof ignored !== 'function')
    throw new Error('Expected watch predicate');
  for (const file of [
    'src\\ignored.ts',
    '/some/project/dist/.rstest-temp/chunk.js',
    '/project/(app)/coverage/index.html',
    '/project/[tests]/config.ts',
    'C:\\project\\.hidden\\file.snap',
  ]) {
    expect(ignored(file), file).toBe(true);
  }
  expect(ignored('/project/(app)/coverage-helper.ts')).toBe(false);
  expect(ignored('/project/src/index.ts')).toBe(false);
});

const snapshot = (
  entries: Record<string, Record<string, string>>,
): EntryHashSnapshot => new Map(Object.entries(entries));

describe('applyWatchInvalidation', () => {
  it('establishes the baseline on first compile without marking anything', () => {
    const state: WatchInvalidationState = {};

    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's1' } }),
    });

    expect(outcome).toEqual({
      rerunAll: false,
      affectedPaths: [],
      deletedPaths: [],
    });
    expect(state.entryHashes?.get('/a.test.ts')).toEqual({ 'a.js': 'h1' });
  });

  it('marks entries whose chunk hashes changed', () => {
    const state: WatchInvalidationState = {};
    applyWatchInvalidation(state, {
      entryHashes: snapshot({
        '/a.test.ts': { 'a.js': 'h1' },
        '/b.test.ts': { 'b.js': 'h1' },
      }),
    });

    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({
        '/a.test.ts': { 'a.js': 'h2' },
        '/b.test.ts': { 'b.js': 'h1' },
      }),
    });

    expect(outcome.affectedPaths).toEqual(['/a.test.ts']);
    expect(outcome.deletedPaths).toEqual([]);
    expect(outcome.rerunAll).toBe(false);
  });

  it('marks added entries and detects deleted entries', () => {
    const state: WatchInvalidationState = {};
    applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
    });

    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/b.test.ts': { 'b.js': 'h1' } }),
    });

    expect(outcome.affectedPaths).toEqual(['/b.test.ts']);
    expect(outcome.deletedPaths).toEqual(['/a.test.ts']);
  });

  it('marks entries whose chunk set changed even with equal hashes', () => {
    const state: WatchInvalidationState = {};
    applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
    });

    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({
        '/a.test.ts': { 'a.js': 'h1', 'lazy.js': 'h1' },
      }),
    });

    expect(outcome.affectedPaths).toEqual(['/a.test.ts']);
  });

  it('returns rerunAll when a setup entry changes, without deleted paths', () => {
    const state: WatchInvalidationState = {};
    applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's1' } }),
    });

    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's2' } }),
    });

    expect(outcome).toEqual({
      rerunAll: true,
      affectedPaths: [],
      deletedPaths: [],
    });
  });

  it('returns rerunAll when a setup entry disappears', () => {
    const state: WatchInvalidationState = {};
    applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's1' } }),
    });

    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
    });

    expect(outcome.rerunAll).toBe(true);
  });

  it('still advances the entry baseline on a rerunAll compile', () => {
    const state: WatchInvalidationState = {};
    applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h1' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's1' } }),
    });

    applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h2' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's2' } }),
    });

    // The a.test.ts change was already covered by the rerun-all compile; the
    // next quiet compile must not re-report it.
    const outcome = applyWatchInvalidation(state, {
      entryHashes: snapshot({ '/a.test.ts': { 'a.js': 'h2' } }),
      setupHashes: snapshot({ '/setup.ts': { 'setup.js': 's2' } }),
    });

    expect(outcome).toEqual({
      rerunAll: false,
      affectedPaths: [],
      deletedPaths: [],
    });
  });

  it('keeps baselines isolated between per-project state handles', () => {
    const stateA: WatchInvalidationState = {};
    const stateB: WatchInvalidationState = {};

    // Both projects use the same compiler-local chunk key ('runner.js').
    applyWatchInvalidation(stateA, {
      entryHashes: snapshot({ '/a/a.test.ts': { 'runner.js': 'a1' } }),
    });
    applyWatchInvalidation(stateB, {
      entryHashes: snapshot({ '/b/b.test.ts': { 'runner.js': 'b1' } }),
    });

    // Project B compiles again; project A's baseline must survive untouched so
    // A's next change still diffs against 'a1'.
    applyWatchInvalidation(stateB, {
      entryHashes: snapshot({ '/b/b.test.ts': { 'runner.js': 'b2' } }),
    });

    const outcome = applyWatchInvalidation(stateA, {
      entryHashes: snapshot({ '/a/a.test.ts': { 'runner.js': 'a2' } }),
    });

    expect(outcome.affectedPaths).toEqual(['/a/a.test.ts']);
  });
});
