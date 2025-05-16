import { describe, expect, it } from '@rstest/core';

describe('test snapshot obsolete', () => {
  it.skip('test snapshot generate', () => {
    expect(1).toBe(1);
  });
});
