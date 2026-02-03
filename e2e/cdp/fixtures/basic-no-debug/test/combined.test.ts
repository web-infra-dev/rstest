import { describe, expect, it } from '@rstest/core';
import { summarizeScores } from '../src/math';
import { formatUser } from '../src/profile';

describe('combined tests', () => {
  it('formats user profile', () => {
    const profile = formatUser('Ada Lovelace', 'admin');

    expect(profile.displayName).toBe('Ada Lovelace');
    expect(profile.normalized).toBe('ada-lovelace');
  });

  it('summarizes scores', () => {
    const result = summarizeScores([12, 18, 30]);

    expect(result.total).toBe(60);
    expect(result.average).toBe(20);
    expect(result.weightedTotal).toBe(65);
  });
});
