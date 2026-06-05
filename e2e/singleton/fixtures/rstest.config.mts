import { defineConfig } from '@rstest/core';

const TestNoIsolate = process.env.TestNoIsolate === 'true';

export default defineConfig({
  setupFiles: ['./setup.ts'],
  isolate: !TestNoIsolate,
  source: {
    define: {
      'process.env.TestNoIsolate': TestNoIsolate,
    },
  },
  pool: {
    type: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
