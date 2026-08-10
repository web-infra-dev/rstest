import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    swc: {
      jsc: {
        parser: {
          syntax: 'ecmascript',
          decorators: true,
        },
      },
    },
  },
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
