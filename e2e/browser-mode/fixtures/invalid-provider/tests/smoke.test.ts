import { describe, expect, it } from '@rstest/core';

describe('smoke', () => {
  it('should not run with invalid provider', () => {
    expect(true).toBe(true);
  });
});
