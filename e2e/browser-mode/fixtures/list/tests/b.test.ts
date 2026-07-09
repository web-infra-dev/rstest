import { describe, it } from '@rstest/core';

describe('browser list nested', () => {
  describe('nested', () => {
    it('should include nested test', () => {
      // This test should be collected by `rstest list` (browser collect mode)
    });
  });
});
