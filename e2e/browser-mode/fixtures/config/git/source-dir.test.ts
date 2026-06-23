import { describe, expect, it } from '@rstest/core';

describe('browser context exclude glob', () => {
  it('does not exclude bare git source directories', () => {
    expect(location.href).toContain('localhost');
  });
});
