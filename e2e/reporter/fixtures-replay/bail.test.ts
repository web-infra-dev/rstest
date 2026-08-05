import { describe, expect, it } from '@rstest/core';

describe('bail outer', () => {
  it('failing case', () => {
    expect(1).toBe(2);
  });

  it('elided sibling', () => {
    expect(1).toBe(1);
  });

  describe('elided inner', () => {
    it('elided nested case', () => {
      expect(1).toBe(1);
    });
  });
});

describe('elided outer sibling', () => {
  it('elided trailing case', () => {
    expect(1).toBe(1);
  });
});
