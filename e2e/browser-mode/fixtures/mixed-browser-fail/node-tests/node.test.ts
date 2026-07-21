import { describe, expect, it } from '@rstest/core';

describe('mixed node project (all passing)', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
  });

  it('also passes', () => {
    expect('rstest').toContain('test');
  });
});
