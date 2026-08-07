import { defineConfig } from '@rstest/core';

export default defineConfig({
  includeSource: ['src/**/*.{js,ts}'],
  isolate: false,
  pool: { maxWorkers: 1 },
});
