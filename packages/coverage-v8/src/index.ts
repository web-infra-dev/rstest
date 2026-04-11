import type { RsbuildPlugin } from '@rsbuild/core';

export { CoverageProvider } from './provider';

export const pluginCoverage = (): RsbuildPlugin => ({
  name: 'rstest:coverage-v8',
  setup() {},
});
