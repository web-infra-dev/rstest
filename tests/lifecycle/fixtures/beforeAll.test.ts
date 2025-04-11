import { beforeAll, describe, expect, it } from '@rstest/core';

beforeAll(() => {
  console.log('[beforeAll] root');
});

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);
  });

  beforeAll(() => {
    console.log('[beforeAll] in level A');
  });

  describe('level B-A', () => {
    it('it in level B-A', () => {
      expect(2 + 1).toBe(3);
    });

    beforeAll(() => {
      console.log('[beforeAll] in level B-A');
    });
  });

  describe('level B-B', () => {
    it('it in level B-B', () => {
      expect(2 + 2).toBe(4);
    });

    beforeAll(() => {
      console.log('[beforeAll] in level B-B');
    });
  });
});
