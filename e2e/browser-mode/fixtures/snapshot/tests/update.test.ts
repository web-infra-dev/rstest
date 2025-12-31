import { describe, expect, it } from '@rstest/core';

describe('browser snapshot update', () => {
  it('should match updatable snapshot', () => {
    const value = 'ORIGINAL_VALUE';
    expect(value).toMatchSnapshot();
  });
});
