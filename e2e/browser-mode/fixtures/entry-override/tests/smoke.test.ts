import { describe, expect, it } from '@rstest/core';

describe('browser entry override', () => {
  it('should run tests normally', () => {
    expect(typeof document).toBe('object');
  });
});
