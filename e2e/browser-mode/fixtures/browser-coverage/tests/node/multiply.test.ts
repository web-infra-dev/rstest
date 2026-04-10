import { describe, expect, it } from '@rstest/core';
import { multiply } from '../../src/multiply';

describe('multiply', () => {
  it('should multiply two numbers', () => {
    expect(multiply(2, 3)).toBe(6);
  });
});
