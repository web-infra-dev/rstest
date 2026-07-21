import { describe, expect, it } from '@rstest/core';
import { applyOnlyFailuresSelection } from '../../src/core/onlyFailures';
import {
  type CachedFileResult,
  type ResultsCacheData,
  sequenceKey,
} from '../../src/core/resultsCache';
import type { SequenceHints } from '../../src/core/testSequencer';

const rootPath = '/root';

type Plan = {
  p: { name: string; environmentName: string };
  finalEntries: { testPath: string }[];
};

const plan = (name: string, files: string[]): Plan => ({
  p: { name, environmentName: name },
  finalEntries: files.map((testPath) => ({ testPath })),
});

const paths = (p: Plan): string[] => p.finalEntries.map((e) => e.testPath);

const hints = (
  entries: [project: string, testPath: string, result: CachedFileResult][],
): SequenceHints =>
  new Map(
    entries.map(([project, testPath, result]) => [
      sequenceKey(project, rootPath, testPath),
      result,
    ]),
  );

const CACHE: ResultsCacheData = { version: 1, files: {} };

describe('applyOnlyFailuresSelection', () => {
  it('keeps everything when there is no results cache', () => {
    const plans = [plan('proj', ['/root/a.test.ts', '/root/b.test.ts'])];
    applyOnlyFailuresSelection(plans, {
      resultsCache: undefined,
      sequenceHints: new Map(),
      rootPath,
    });
    expect(paths(plans[0]!)).toEqual(['/root/a.test.ts', '/root/b.test.ts']);
  });

  it('narrows a covered project to its failed files', () => {
    const plans = [
      plan('proj', ['/root/a.test.ts', '/root/b.test.ts', '/root/c.test.ts']),
    ];
    applyOnlyFailuresSelection(plans, {
      resultsCache: CACHE,
      sequenceHints: hints([
        ['proj', '/root/a.test.ts', { failed: true, at: 0 }],
        ['proj', '/root/b.test.ts', { failed: false, at: 0 }],
        ['proj', '/root/c.test.ts', { failed: true, at: 0 }],
      ]),
      rootPath,
    });
    expect(paths(plans[0]!)).toEqual(['/root/a.test.ts', '/root/c.test.ts']);
  });

  it('keeps everything when nothing failed on the previous run', () => {
    const plans = [plan('proj', ['/root/a.test.ts', '/root/b.test.ts'])];
    applyOnlyFailuresSelection(plans, {
      resultsCache: CACHE,
      sequenceHints: hints([
        ['proj', '/root/a.test.ts', { failed: false, at: 0 }],
        ['proj', '/root/b.test.ts', { failed: false, at: 0 }],
      ]),
      rootPath,
    });
    expect(paths(plans[0]!)).toEqual(['/root/a.test.ts', '/root/b.test.ts']);
  });

  it('runs all files of a project absent from the cache (fallback)', () => {
    const plans = [
      plan('node', ['/root/a.test.ts', '/root/b.test.ts']),
      plan('browser', ['/root/x.test.ts', '/root/y.test.ts']),
    ];
    applyOnlyFailuresSelection(plans, {
      resultsCache: CACHE,
      // Only the node project is recorded; the browser project is uncovered.
      sequenceHints: hints([
        ['node', '/root/a.test.ts', { failed: true, at: 0 }],
        ['node', '/root/b.test.ts', { failed: false, at: 0 }],
      ]),
      rootPath,
    });
    // Covered node project narrows to its failed file.
    expect(paths(plans[0]!)).toEqual(['/root/a.test.ts']);
    // Uncovered browser project runs all of its files rather than being deselected.
    expect(paths(plans[1]!)).toEqual(['/root/x.test.ts', '/root/y.test.ts']);
  });

  it('runs everything when covered projects are clean and only an uncovered project has files', () => {
    const plans = [
      plan('node', ['/root/a.test.ts', '/root/b.test.ts']),
      plan('browser', ['/root/x.test.ts']),
    ];
    applyOnlyFailuresSelection(plans, {
      resultsCache: CACHE,
      // The node project is recorded and fully clean; the browser project is
      // uncovered. Nothing failed, so the run-everything fallback must win —
      // the clean node project must not be deselected.
      sequenceHints: hints([
        ['node', '/root/a.test.ts', { failed: false, at: 0 }],
        ['node', '/root/b.test.ts', { failed: false, at: 0 }],
      ]),
      rootPath,
    });
    expect(paths(plans[0]!)).toEqual(['/root/a.test.ts', '/root/b.test.ts']);
    expect(paths(plans[1]!)).toEqual(['/root/x.test.ts']);
  });

  it('drops never-run (uncached) files while keeping the failed ones', () => {
    const plans = [plan('proj', ['/root/failed.test.ts', '/root/new.test.ts'])];
    applyOnlyFailuresSelection(plans, {
      resultsCache: CACHE,
      sequenceHints: hints([
        ['proj', '/root/failed.test.ts', { failed: true, at: 0 }],
      ]),
      rootPath,
    });
    expect(paths(plans[0]!)).toEqual(['/root/failed.test.ts']);
  });
});
