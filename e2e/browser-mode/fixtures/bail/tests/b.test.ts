import { describe, expect, it } from '@rstest/core';

describe('bail file B', () => {
  it('logs a marker then fails', () => {
    console.log('BAIL_MARKER_B');
    expect(1 + 1).toBe(3);
  });
});
