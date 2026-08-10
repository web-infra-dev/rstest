import { defineConfig } from '@rstest/core';

export default defineConfig({
  source: {
    transformImport: [
      {
        libraryName: 'demo-lib',
        libraryDirectory: '.',
      },
    ],
  },
  coverage: {
    enabled: true,
    provider: 'istanbul',
  },
});
