import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    clean: true,
    reporters: ['text'],
  },
});
