import { describe, expect, it } from '@rstest/core';

describe('mixed node project', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
  });

  it('fails with a marked error', () => {
    // The token lives in the error message so it only surfaces in the
    // "Summary of all failing tests" detail block, not the inline `✗` line.
    throw new Error('MIXED_NODE_ERR');
  });
});
