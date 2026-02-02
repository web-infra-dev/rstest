import { describe, it } from '@rstest/core';

describe('agent-md', () => {
  it('triggers unhandled error', async () => {
    // Schedule an unhandled error via setTimeout
    setTimeout(() => {
      throw new Error('unhandled async error');
    }, 10);

    // Wait long enough for the timeout to fire
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
