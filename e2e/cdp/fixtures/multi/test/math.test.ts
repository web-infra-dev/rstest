import { describe, expect, it } from '@rstest/core';
import { summarizeScores } from '../src/math';

describe('score summary', () => {
  it('computes totals', () => {
    const result = summarizeScores([12, 18, 30]);

    expect(result.total).toBe(60);
    expect(result.average).toBe(20);
    expect(result.weightedTotal).toBe(65);
  });
});
