import { describe, expect, it } from '@rstest/core';

it('should allow run test without suite wrapped', () => {
  expect(1 + 1).toBe(2);
});

describe('Test Suite', () => {
  it('should allow run test in suite', () => {
    expect(1 + 1).toBe(2);
  });

  describe('Test Suite Nested', () => {
    it('should allow run test in nested suite', () => {
      expect(1 + 1).toBe(2);
    });
  });

  it('should allow run test in suite - 1', () => {
    expect(1 + 1).toBe(2);
  });
});

describe('Test Suite - 1', () => {
  it('should ok', () => {
    expect(1 + 1).toBe(2);
  });
});
