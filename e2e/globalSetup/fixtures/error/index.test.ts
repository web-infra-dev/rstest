import { describe, it } from '@rstest/core';

describe('should not run this test due to global setup error', () => {
  it('should not be executed', () => {
    // This test should not run if global setup fails
    console.log('This should not be printed');
  });
});
