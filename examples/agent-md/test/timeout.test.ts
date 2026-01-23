import { describe, it } from '@rstest/core';

describe('billing sync', () => {
  it('times out while waiting for gateway', async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }, 50);
});
