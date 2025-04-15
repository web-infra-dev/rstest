import { afterEach, describe, expect, it } from '@rstest/core';

afterEach(() => {
  console.log('[afterEach] root');
});

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);
  });

  afterEach(() => {
    console.log('[afterEach] in level A');
  });

  describe('level B-A', () => {
    it('it in level B-A', () => {
      expect(2 + 1).toBe(3);
    });

    afterEach(() => {
      console.log('[afterEach] in level B-A');
    });
  });

  describe('level B-B', () => {
    it('it in level B-B', () => {
      expect(2 + 2).toBe(4);
    });

    afterEach(() => {
      console.log('[afterEach] in level B-B');
    });
  });
});
