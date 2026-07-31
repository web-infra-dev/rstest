import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/workerCleanup*.fixture.ts'],
  isolate: false,
  pool: {
    maxWorkers: 1,
  },
  coverage: {
    enabled: true,
    include: ['src/workerCleanup.ts'],
    reporters: ['text', 'json'],
  },
});
