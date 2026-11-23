// @rstest-environment jsdom
// @rstest-environment-options { "url": "https://rstest.example/comment" }
import { describe, expect, it } from '@rstest/core';
import { assertFreshEnvironment } from './environmentCommentAssertions';

describe('environment comment', () => {
  it('runs this file with the annotated environment and options', () => {
    assertFreshEnvironment();
    expect(window.location.href).toBe('https://rstest.example/comment');
  });
});
