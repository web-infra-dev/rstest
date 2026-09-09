import { describe, expect, it } from '@rstest/core';

describe('environment comment node', () => {
  it('keeps files without environment comments in node', () => {
    expect(globalThis.document).toBeUndefined();
  });
});
