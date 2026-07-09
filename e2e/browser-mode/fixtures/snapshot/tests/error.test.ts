import { describe, expect, it } from '@rstest/core';

describe('browser snapshot - error', () => {
  it('should match error snapshot', () => {
    const throwError = () => {
      throw new Error('Test error message');
    };
    expect(throwError).toThrowErrorMatchingSnapshot();
  });
});
