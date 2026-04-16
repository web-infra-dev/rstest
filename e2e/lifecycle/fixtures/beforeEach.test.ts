import { beforeEach, describe, expect, it } from '@rstest/core';
import { sleep } from '../../scripts';

beforeEach(() => {
  console.log('[beforeEach] root');
});

beforeEach(async () => {
  await sleep(100);
  console.log('[beforeEach] root async');
});

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

    beforeEach((ctx) => {
      expect(ctx.task.name).toBe('it in level B-B');
      console.log('[beforeEach] in level B-B');
    });
  });
});
