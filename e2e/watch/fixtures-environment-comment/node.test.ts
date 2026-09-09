import { describe, expect, it } from '@rstest/core';

describe('watch base environment', () => {
  it('runs in node', () => {
    expect(globalThis.document).toBeUndefined();
  });
});
