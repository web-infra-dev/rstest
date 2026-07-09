import { describe, it } from '@rstest/core';

describe('agent-md', () => {
  it('fails with thrown error', () => {
    throw new Error('boom');
  });
});
