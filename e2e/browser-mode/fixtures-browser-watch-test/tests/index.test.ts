import { describe, expect, it } from '@rstest/core';

describe('watch mode test', () => {
  it('should pass initial test', () => {
    expect('initial').toBe('modified');
  });
});
