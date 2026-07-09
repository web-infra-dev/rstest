import { describe, expect, it } from '@rstest/core';

describe('agent-md-pass', () => {
  it('passed case', () => {
    expect(1 + 1).toBe(2);
  });

  it.skip('skipped case', () => {
    expect(1 + 1).toBe(3);
  });
});
