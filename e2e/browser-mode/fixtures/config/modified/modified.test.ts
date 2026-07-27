import { expect, test } from '@rstest/core';

test('modifyRstestConfig applies browser test discovery and Rsbuild config', () => {
  expect(location.href).toContain('localhost');
  // @ts-expect-error - defined by a browser Rsbuild plugin through getRstestConfig
  expect(__GET_RSTEST_CONFIG_BROWSER_ENABLED__).toBe(true);
  // @ts-expect-error - defined by a browser Rsbuild plugin through getRstestConfig
  expect(__GET_RSTEST_CONFIG_INCLUDE__).toEqual([
    './*.test.ts',
    './git/*.test.ts',
  ]);
  // @ts-expect-error - defined by a browser Rsbuild plugin through getRstestConfig
  expect(__GET_RSTEST_CONFIG_POOL__).toBe('forks');
  // @ts-expect-error - defined by a browser Rsbuild plugin through modifyRstestConfig
  expect(__MODIFY_RSTEST_CONFIG_DEFINE__).toBe('modified-value');
});
