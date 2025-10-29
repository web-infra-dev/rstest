import { describe, expect, it } from '@rstest/core';

describe('state isolation', () => {
  it('resets globals across pages', () => {
    (window as any).__rstest_flag__ ??= 0;
    (window as any).__rstest_flag__ += 1;
    expect((window as any).__rstest_flag__).toBe(1);
  });
});
