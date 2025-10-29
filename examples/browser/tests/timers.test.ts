import { describe, expect, it } from '@rstest/core';

describe('timers', () => {
  it('uses real timers per page', async () => {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });
});
