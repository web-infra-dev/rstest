// @ts-expect-error node builtin module
import _http_common from 'node:_http_common';
import { describe, expect, it } from '@rstest/core';

describe('node built-in modules', () => {
  it('should load node built-in modules correctly', () => {
    expect(_http_common).toBeDefined();
  });

  it('should expose process APIs without pool-specific shims', () => {
    expect(typeof process.cwd()).toBe('string');
    expect(typeof process.pid).toBe('number');
    expect(typeof process.platform).toBe('string');
    expect(typeof process.versions.node).toBe('string');
  });
});
