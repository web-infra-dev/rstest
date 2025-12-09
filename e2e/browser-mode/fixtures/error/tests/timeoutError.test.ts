import { describe, it } from '@rstest/core';

describe('timeout error', () => {
  it('should timeout', async () => {
    // This test will timeout
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10000));
  }, 100);
});
