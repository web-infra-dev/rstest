import { describe, expect, it } from '@rstest/core';

describe('browser failing test', () => {
  it('should fail in browser', () => {
    expect('4').toBe('41');
  });
});
