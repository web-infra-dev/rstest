import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    swc: (config) => {
      if (config.jsc?.parser) {
        config.jsc.parser.decorators = true;
      }
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
