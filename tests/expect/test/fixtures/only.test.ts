import { beforeEach, describe, expect, it } from '@rstest/core';

beforeEach(() => {
  console.log('[beforeEach] root');
});

describe('level A', () => {
  // biome-ignore lint/suspicious/noFocusedTests: <explanation>
  it.only('it in level A', () => {
    console.log('[test] in level A');
    expect(1 + 1).toBe(2);
  });

  describe('level B', () => {
    it('it in level B-A', () => {
      console.log('[test] in level B-A');
      expect(2 + 1).toBe(3);
    });

    // biome-ignore lint/suspicious/noFocusedTests: <explanation>
    it.only('it in level B-B', () => {
      console.log('[test] in level B-B');
      expect(2 + 1).toBe(3);
    });
  });

  it('it in level C', () => {
    console.log('[test] in level C');
    expect(2 + 2).toBe(4);
  });
});

// biome-ignore lint/suspicious/noFocusedTests: <explanation>
it.only('it in level D', () => {
  console.log('[test] in level D');
  expect(1 + 1).toBe(2);
});

describe('level E', () => {
  it('it in level E-A', () => {
    console.log('[test] in level E-A');
    expect(2 + 1).toBe(3);
  });
});
