// @rstest-environment jsdom
// @rstest-environment-options { "url": "https://rstest.example/comment" }
import { describe, expect, it } from '@rstest/core';

describe('environment comment', () => {
  it('runs this file with the annotated environment and options', () => {
    expect(window.location.href).toBe('https://rstest.example/comment');
  });
});
