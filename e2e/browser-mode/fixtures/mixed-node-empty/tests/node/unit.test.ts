import { describe, expect, it } from '@rstest/core';

// A real node-project test that is filtered out when the run targets only the
// browser test file — this is what makes the node project match zero files.
describe('node unit', () => {
  it('is skipped when only the browser test is selected', () => {
    expect(1 + 1).toBe(2);
  });
});
