import { describe, expect, it } from '@rstest/core';

describe('node passing test', () => {
  it('should pass in node', () => {
    expect(1).toBe(1);
  });
});
