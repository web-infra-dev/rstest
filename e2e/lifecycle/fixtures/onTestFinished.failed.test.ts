import { afterEach, describe, expect, it, onTestFinished } from '@rstest/core';

describe('level A', () => {
  it('it in level A', () => {
    expect(1 + 1).toBe(2);

    onTestFinished(() => {
      throw new Error('onTestFinished failed');
    });
  });

  afterEach(() => {
    console.log('[afterEach] in level A');
  });
});
