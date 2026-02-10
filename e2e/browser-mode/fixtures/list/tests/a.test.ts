import { describe, expect, it } from '@rstest/core';

describe('browser list', () => {
  it('should include this test in list', () => {
    // This test should be collected by `rstest list` (browser collect mode)
    expect(true).toBe(true);
  });

  it.skip('should NOT be listed (skip)', () => {
    // skipped
  });

  it.todo('should NOT be listed (todo)');
});
