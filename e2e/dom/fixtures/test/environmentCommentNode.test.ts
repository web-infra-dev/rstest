import { describe, expect, it } from '@rstest/core';
import { assertFreshEnvironment } from './environmentCommentAssertions';

describe('environment comment node', () => {
  it('keeps files without environment comments in node', () => {
    assertFreshEnvironment();
    expect(globalThis.document).toBeUndefined();
  });
});
