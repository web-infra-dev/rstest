import { describe, expect, it } from '@rstest/core';

describe('Index', () => {
  it('should add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should add two numbers incorrectly', () => {
    expect(1 + 1).toBe(3);
  });

  it('should add two numbers correctly1', () => {
    expect(1 + 1).toBe(2);
  });
});
