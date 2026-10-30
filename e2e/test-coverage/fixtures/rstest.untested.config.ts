import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/date.test.ts'],
  tools: {
    swc: {
      minify: true,
      jsc: {
        preserveAllComments: false,
        minify: {
          compress: false,
          mangle: false,
          format: { comments: false },
        },
      },
    },
  },
  coverage: {
    enabled: true,
    provider: 'istanbul',
    include: ['test-temp-sourcemap/dist/**/*.js', 'src/untested.jsx'],
    reporters: ['json', 'json-summary'],
  },
});
