import { describe, expect, it } from '@rstest/core';

describe.skip('level A', () => {
  // biome-ignore lint/suspicious/noFocusedTests: <explanation>
  it.only('it in level A', () => {
    console.log('[test] in level A');
    expect(1 + 1).toBe(2);
  });

  it('it in level B', () => {
    console.log('[test] in level B');
    expect(2 + 2).toBe(4);
  });
});

describe('level E', () => {
  it('it in level E-A', () => {
    console.log('[test] in level E-A');
    expect(2 + 1).toBe(3);
  });
});
