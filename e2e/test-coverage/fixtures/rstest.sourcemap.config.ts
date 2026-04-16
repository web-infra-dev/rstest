import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    clean: true,
    reporters: ['text'],
  },
});
