import { describe, expect, it } from '@rstest/core';
// @ts-expect-error node builtin module
import _http_common from '_http_common';

describe('node built-in modules', () => {
  it('should load node built-in modules correctly', () => {
    expect(_http_common).toBeDefined();
  });
});
