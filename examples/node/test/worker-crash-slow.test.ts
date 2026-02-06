import { describe, expect, it } from '@rstest/core';

describe('Slow test', () => {
  it('keeps the main process alive', async () => {
    // This runs on a different worker. It keeps the main process alive
    // long enough for worker-crash.test.ts's delayed kill to fire.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(1 + 1).toBe(2);
  });
});
