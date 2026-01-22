import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    include: ['test-temp-sourcemap-dist/sourcemap.js'],
    clean: true,
    reporters: ['text'],
  },
});
