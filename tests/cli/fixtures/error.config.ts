import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    type: 'forks',
    maxWorkers: 4,
    minWorkers: 5,
  },
});
