import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['v8-src/**'],
    reporters: ['json-summary'],
  },
});
