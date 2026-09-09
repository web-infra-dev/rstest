import { describe, expect, it } from '@rstest/core';
import { percentValue } from '../src/100%';
import { sum } from '../src/sum';

describe('sum', () => {
  it('should add two numbers', () => {
    expect(sum(1, 2)).toBe(3);
    expect(percentValue).toBe(100);
  });
});
