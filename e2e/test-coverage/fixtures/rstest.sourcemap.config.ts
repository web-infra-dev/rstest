import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    clean: true,
    reporters: ['text'],
  },
});
