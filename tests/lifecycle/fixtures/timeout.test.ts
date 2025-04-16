import { beforeAll, beforeEach, describe, expect, it } from '@rstest/core';
import { sleep } from '../../scripts';

beforeAll(async () => {
  console.log('[beforeAll] root');
  await sleep(100);
}, 10);

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);
  });

  beforeEach(() => {
    console.log('[beforeEach] in level A');
  });

  describe('level B-A', () => {
    it('it in level B-A', () => {
      expect(2 + 1).toBe(3);
    });

    beforeEach(() => {
      console.log('[beforeEach] in level B-A');
    });
  });

  describe('level B-B', () => {
    it('it in level B-B', () => {
      expect(2 + 2).toBe(4);
    });

    beforeEach(() => {
      console.log('[beforeEach] in level B-B');
    });
  });
});
