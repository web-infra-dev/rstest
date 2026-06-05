import { describe, expect, it } from '@rstest/core';
import { triple } from '../src/calc';

describe('triple', () => {
  it('runs the source but fails the assertion on purpose', () => {
    // triple(2) === 6; assert 7 so the file is covered yet the run fails,
    // exercising the coverage `reportOnFailure` guard.
    expect(triple(2)).toBe(7);
  });
});
