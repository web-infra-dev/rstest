import { describe, expect, it } from '@rstest/core';

describe('unrelated', () => {
  it('does not import the math source', () => {
    expect(true).toBe(true);
  });
});
