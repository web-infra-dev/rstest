import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  // One worker, reused across watch rebuilds — the exact condition under which a
  // kept runtime chunk could otherwise serve a changed shared module stale.
  pool: { maxWorkers: 1 },
  dev: {
    writeToDisk: process.env.RSTEST_TEST_FILTER_DISK_ASSETS
      ? (filename) => filename.includes('rstest-runtime')
      : false,
  },
});
