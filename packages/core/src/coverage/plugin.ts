import fs from 'node:fs';
import type { RsbuildPlugin } from '@rstest/core';
import type { NormalizedCoverageOptions } from '../types/coverage';

export const pluginCoverageCore: (
  coverageOptions: NormalizedCoverageOptions,
) => RsbuildPlugin = (coverageOptions) => ({
  name: 'rstest:coverage-core',
  setup: (api) => {
    api.onBeforeDevCompile(async ({ isFirstCompile }) => {
      if (isFirstCompile && coverageOptions.clean) {
        if (fs.existsSync(coverageOptions.reportsDirectory)) {
          fs.rmSync(coverageOptions.reportsDirectory, { recursive: true });
        }
      }
    });
  },
});
