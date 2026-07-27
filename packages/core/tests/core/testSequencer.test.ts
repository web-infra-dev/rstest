import { describe, expect, it } from '@rstest/core';
import {
  filterFailedEntries,
  type SequenceHints,
  sortTestEntries,
} from '../../src/core/testSequencer';

type Entry = { testPath: string; size?: number };

const order = (entries: Entry[], hints: SequenceHints = new Map()): string[] =>
  sortTestEntries(entries, hints, (testPath) => testPath).map(
    (e) => e.testPath,
  );

describe('sortTestEntries', () => {
  it('puts last-failed files first', () => {
    const entries: Entry[] = [
      { testPath: 'a', size: 10 },
      { testPath: 'b', size: 10 },
      { testPath: 'c', size: 10 },
    ];
    const hints: SequenceHints = new Map([
      ['a', { duration: 5 }],
      ['b', { duration: 5, failed: true }],
      ['c', { duration: 5 }],
    ]);
    expect(order(entries, hints)[0]).toBe('b');
  });

  it('orders new files (no duration) before known files', () => {
    const entries: Entry[] = [
      { testPath: 'known', size: 1 },
      { testPath: 'new', size: 1 },
    ];
    const hints: SequenceHints = new Map([['known', { duration: 999 }]]);
    expect(order(entries, hints)).toEqual(['new', 'known']);
  });

  it('orders new files by bundle size descending', () => {
    const entries: Entry[] = [
      { testPath: 'small', size: 10 },
      { testPath: 'large', size: 1000 },
      { testPath: 'medium', size: 100 },
    ];
    expect(order(entries)).toEqual(['large', 'medium', 'small']);
  });

  it('orders known files by duration descending (LPT)', () => {
    const entries: Entry[] = [
      { testPath: 'fast' },
      { testPath: 'slow' },
      { testPath: 'mid' },
    ];
    const hints: SequenceHints = new Map([
      ['fast', { duration: 10 }],
      ['slow', { duration: 1000 }],
      ['mid', { duration: 100 }],
    ]);
    expect(order(entries, hints)).toEqual(['slow', 'mid', 'fast']);
  });

  it('breaks ties by testPath.localeCompare', () => {
    const entries: Entry[] = [
      { testPath: 'c', size: 5 },
      { testPath: 'a', size: 5 },
      { testPath: 'b', size: 5 },
    ];
    // equal size, equal (absent) duration → deterministic alphabetical
    expect(order(entries)).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic with empty hints (cold start)', () => {
    const entries: Entry[] = [
      { testPath: 'z', size: 5 },
      { testPath: 'a', size: 5 },
      { testPath: 'm', size: 20 },
    ];
    expect(order(entries)).toEqual(order(entries));
    expect(order(entries)).toEqual(['m', 'a', 'z']);
  });

  it('does not mutate the input array', () => {
    const entries: Entry[] = [
      { testPath: 'small', size: 1 },
      { testPath: 'large', size: 100 },
    ];
    const snapshot = [...entries];
    sortTestEntries(entries, new Map(), (p) => p);
    expect(entries).toEqual(snapshot);
  });

  it('ranks failed > new > known, size/duration within each group', () => {
    const entries: Entry[] = [
      { testPath: 'known-fast', size: 0 },
      { testPath: 'known-slow', size: 0 },
      { testPath: 'new-small', size: 1 },
      { testPath: 'new-big', size: 100 },
      { testPath: 'failed', size: 0 },
    ];
    const hints: SequenceHints = new Map([
      ['known-fast', { duration: 10 }],
      ['known-slow', { duration: 500 }],
      ['failed', { duration: 1, failed: true }],
    ]);
    expect(order(entries, hints)).toEqual([
      'failed',
      'new-big',
      'new-small',
      'known-slow',
      'known-fast',
    ]);
  });
});

describe('filterFailedEntries', () => {
  const keep = (entries: Entry[], hints: SequenceHints) =>
    filterFailedEntries(entries, hints, (testPath) => testPath);

  it('keeps files whose last run failed', () => {
    const entries: Entry[] = [
      { testPath: 'a' },
      { testPath: 'b' },
      { testPath: 'c' },
    ];
    const hints: SequenceHints = new Map([
      ['a', { duration: 5 }],
      ['b', { duration: 5, failed: true }],
      ['c', { duration: 5, failed: true }],
    ]);
    const result = keep(entries, hints);
    expect(result.covered).toBe(true);
    expect(result.entries.map((e) => e.testPath)).toEqual(['b', 'c']);
  });

  it('drops files that previously passed', () => {
    const entries: Entry[] = [{ testPath: 'a' }, { testPath: 'b' }];
    const hints: SequenceHints = new Map([
      ['a', { duration: 5, failed: false }],
      ['b', { duration: 5 }],
    ]);
    const result = keep(entries, hints);
    expect(result.covered).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it('drops files with no hint (never run / newly added) when others are covered', () => {
    const entries: Entry[] = [
      { testPath: 'known-failed' },
      { testPath: 'brand-new' },
    ];
    const hints: SequenceHints = new Map([
      ['known-failed', { duration: 5, failed: true }],
    ]);
    const result = keep(entries, hints);
    expect(result.covered).toBe(true);
    expect(result.entries.map((e) => e.testPath)).toEqual(['known-failed']);
  });

  it('falls back to all entries when the project is absent from the cache', () => {
    const entries: Entry[] = [{ testPath: 'a' }, { testPath: 'b' }];
    // Hints only cover a different project's files → this project is uncovered.
    const hints: SequenceHints = new Map([['other', { failed: true }]]);
    const result = keep(entries, hints);
    expect(result.covered).toBe(false);
    expect(result.entries).toBe(entries);
  });

  it('preserves input order and does not mutate the input', () => {
    const entries: Entry[] = [
      { testPath: 'c' },
      { testPath: 'a' },
      { testPath: 'b' },
    ];
    const snapshot = [...entries];
    const hints: SequenceHints = new Map([
      ['c', { failed: true }],
      ['a', { failed: true }],
      ['b', { failed: false }],
    ]);
    const result = keep(entries, hints);
    // original relative order kept (c before a); sorting happens separately
    expect(result.entries.map((e) => e.testPath)).toEqual(['c', 'a']);
    expect(entries).toEqual(snapshot);
  });
});
