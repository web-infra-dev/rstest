import { describe, expect, it } from '@rstest/core';

describe('bail file A', () => {
  it('logs a marker then fails', () => {
    console.log('BAIL_MARKER_A');
    expect(1 + 1).toBe(3);
  });
});
