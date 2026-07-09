import { describe, expect, it } from '@rstest/core';

describe('basic test', () => {
  it('should pass', () => {
    console.log('Running basic test...');
    expect(true).toBe(true);
  });
});
