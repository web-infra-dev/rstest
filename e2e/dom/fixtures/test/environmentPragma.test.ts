// @rstest-environment jsdom
// @rstest-environment-options { "url": "https://rstest.example/pragma" }
import { describe, expect, it } from '@rstest/core';

describe('environment pragma', () => {
  it('runs this file with the annotated environment and options', () => {
    expect(window.location.href).toBe('https://rstest.example/pragma');
  });
});
