import { describe, expect, it } from '@rstest/core';

describe('mixed browser project', () => {
  it('passes', () => {
    expect(typeof window).toBe('object');
  });

  it('fails with a marked error', () => {
    // The token lives in the error message so it only surfaces in the
    // "Summary of all failing tests" detail block, not the inline `✗` line.
    throw new Error('MIXED_BROWSER_ERR');
  });
});
