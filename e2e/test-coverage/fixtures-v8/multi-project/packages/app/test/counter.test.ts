import { describe, expect, it } from '@rstest/core';
import { double } from '../src/counter';

describe('counter', () => {
  it('doubles a number', () => {
    expect(double(2)).toBe(4);
  });
});
