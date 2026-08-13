import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    swc: (config) => {
      if (config.jsc?.parser) {
        config.jsc.parser.decorators = true;
      }
    },
  },
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['v8-src/**'],
    reporters: ['json-summary'],
  },
});
