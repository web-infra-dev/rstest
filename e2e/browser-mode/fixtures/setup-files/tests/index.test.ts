import { describe, expect, it } from '@rstest/core';

describe('setup files', () => {
  it('should have setup file executed', () => {
    expect((globalThis as Record<string, unknown>).__SETUP_EXECUTED__).toBe(
      true,
    );
  });

  it('should have setup timestamp', () => {
    const timestamp = (globalThis as Record<string, unknown>)
      .__SETUP_TIMESTAMP__ as number;
    expect(typeof timestamp).toBe('number');
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('should have custom helper from setup', () => {
    const helper = (globalThis as Record<string, unknown>).__customHelper__ as (
      value: string,
    ) => string;
    expect(typeof helper).toBe('function');
    expect(helper('hello')).toBe('HELLO');
  });
});
