import { describe, expect, it } from '@rstest/core';

describe('Junit test', () => {
  it('should pass', () => {
    expect(1 + 1).toBe(2);
  });

  it('should fail', () => {
    expect('hi').toBe('hii');
  });

  it.skip('should skip', () => {
    expect(1 + 1).toBe(3);
  });
});
