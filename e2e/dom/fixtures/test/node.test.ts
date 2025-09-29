// @ts-expect-error
import _http_common from 'node:_http_common';
import { describe, expect, it } from '@rstest/core';

describe('node built-in modules', () => {
  it('should load node built-in modules correctly', () => {
    expect(_http_common).toBeDefined();
  });
});
