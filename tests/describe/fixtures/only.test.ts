import { beforeEach, describe, expect, it } from '@rstest/core';

beforeEach(() => {
  console.log('[beforeEach] root');
});

describe('level A', () => {
  it('it in level A', () => {
    console.log('[test] in level A');
    expect(1 + 1).toBe(2);
  });

  // biome-ignore lint/suspicious/noFocusedTests: <explanation>
  describe.only('level B', () => {
    it('it in level B-A', () => {
      console.log('[test] in level B-A');
      expect(2 + 1).toBe(3);
    });

    it.skip('it in level B-B', () => {
      console.log('[test] in level B-B');
      expect(2 + 1).toBe(3);
    });

    describe('level B-C', () => {
      it('it in level B-C-A', () => {
        console.log('[test] in level B-C-A');
        expect(2 + 1).toBe(3);
      });
    });
  });

  it('it in level C', () => {
    console.log('[test] in level C');
    expect(2 + 2).toBe(4);
  });

  describe('level D', () => {
    it('it in level D-A', () => {
      console.log('[test] in level D-A');
      expect(2 + 1).toBe(3);
    });
  });
});

// biome-ignore lint/suspicious/noFocusedTests: <explanation>
describe.only('level E', () => {
  it('it in level E-A', () => {
    console.log('[test] in level E-A');
    expect(2 + 1).toBe(3);
  });
});
