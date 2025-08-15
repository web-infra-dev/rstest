import { describe, expect, it } from '@rstest/core';

describe('1', () => {
  it('2', () => {
    describe('3', () => {
      it('4', () => {
        expect(1 + 1).toBe(2);
      });
    });
  });

  it('5', () => {
    it('6', () => {
      expect(1 + 1).toBe(2);
    });
  });

  it('7', async () => {
    expect(1 + 1).toBe(2);
  });
});
