import { expect, test } from '@rstest/core';

test('modifyRstestConfig applies browser test discovery and Rsbuild config', () => {
  expect(location.href).toContain('localhost');
  // @ts-expect-error - defined by a browser Rsbuild plugin through modifyRstestConfig
  expect(__MODIFY_RSTEST_CONFIG_DEFINE__).toBe('modified-value');
});
