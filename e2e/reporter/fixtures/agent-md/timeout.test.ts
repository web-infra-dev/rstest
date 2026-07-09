import { describe, it } from '@rstest/core';

describe('agent-md', () => {
  it('fails with timeout', async () => {
    await new Promise(() => {
      // Intentionally never resolves.
    });
  });
});
