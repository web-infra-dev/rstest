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
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['v8-src/**'],
    reporters: ['json-summary'],
  },
});
