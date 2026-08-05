import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  pool: {
    maxWorkers: 1,
  },
  projects: ['./jsdom-26/rstest.config.mts', './jsdom-29/rstest.config.mts'],
});
