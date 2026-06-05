import { describe, expect, it } from '@rstest/core';
import { double } from '../../src/calc';

describe('double', () => {
  it('doubles a number in the browser', () => {
    expect(double(3)).toBe(6);
  });
});
