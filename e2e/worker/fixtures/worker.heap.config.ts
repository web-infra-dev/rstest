import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    maxWorkers: 1,
    execArgv: ['--max-old-space-size=512'],
  },
});
