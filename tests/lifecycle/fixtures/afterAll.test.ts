import { afterAll, describe, expect, it } from '@rstest/core';

afterAll(() => {
  console.log('[afterAll] root');
});

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);
  });

  afterAll(() => {
    console.log('[afterAll] in level A');
  });

  describe('level B-A', () => {
    it('it in level B-A', () => {
      expect(2 + 1).toBe(3);
    });

    afterAll(() => {
      console.log('[afterAll] in level B-A');
    });
  });

  describe('level B-B', () => {
    it('it in level B-B', () => {
      expect(2 + 2).toBe(4);
    });

    afterAll(() => {
      console.log('[afterAll] in level B-B');
    });
  });
});
