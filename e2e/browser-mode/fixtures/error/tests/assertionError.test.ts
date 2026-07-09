import { describe, expect, it } from '@rstest/core';

describe('assertion error', () => {
  it('should fail assertion', () => {
    expect(1).toBe(2);
  });
});
