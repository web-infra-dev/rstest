import { describe, expect, it } from '@rstest/core';
import {
  appendSuiteSegment,
  caseKey,
  emptyKey,
  projectKey,
  suiteKey,
} from './treeNodeKey';

describe('treeNodeKey grammar', () => {
  it('builds a single-level suite key', () => {
    expect(suiteKey('/f.test.ts', ['s1'])).toBe('/f.test.ts::suite::s1');
  });

  it('accumulates nested suite keys from ancestor prefixes', () => {
    expect(suiteKey('/f.test.ts', ['s1', 's2'])).toBe(
      '/f.test.ts::suite::s1::suite::s1::s2',
    );
  });

  it('round-trips: the recursive producer fold equals the one-pass accumulation', () => {
    // Producer fold: append one segment per recursion level.
    const level1 = appendSuiteSegment('/f.test.ts', ['s1']);
    const level2 = appendSuiteSegment(level1, ['s1', 's2']);
    // Enumerator one-pass form.
    expect(level2).toBe(suiteKey('/f.test.ts', ['s1', 's2']));
  });

  it('preserves a literal double-colon in a suite name (regression)', () => {
    // Producer accumulation for fullPath ['a::b'] then ['a::b','c'].
    const producer = appendSuiteSegment(
      appendSuiteSegment('/f.test.ts', ['a::b']),
      ['a::b', 'c'],
    );
    // The enumerator must reach the same key without a join→split round-trip.
    expect(suiteKey('/f.test.ts', ['a::b', 'c'])).toBe(producer);
    expect(suiteKey('/f.test.ts', ['a::b'])).toBe('/f.test.ts::suite::a::b');
  });

  it('builds project, case and empty keys', () => {
    expect(projectKey('web')).toBe('__project__web');
    expect(caseKey('/f.test.ts::suite::a', 'id-1')).toBe(
      '/f.test.ts::suite::a::case::id-1',
    );
    expect(emptyKey('/f.test.ts')).toBe('/f.test.ts::__empty');
  });
});
