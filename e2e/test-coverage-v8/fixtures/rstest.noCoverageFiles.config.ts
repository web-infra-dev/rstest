import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/date.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    // Include patterns that match no files
    include: ['nonexistent/**/*.ts'],
  },
});
