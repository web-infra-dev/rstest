import { defineConfig } from '@rstest/core';

export default defineConfig({
  // maxFilesPerWorker: 1 disposes the runner after every task, so each
  // file gets a fresh worker process. With pool.maxWorkers: 2 and 4 files,
  // every file's `process.pid` must be unique — the driver asserts that
  // pidcount === filecount. Default soft-mode reuse would yield fewer
  // pids than files (covered by e2e/soft-mode-reuse).
  experiments: {
    softMode: { maxFilesPerWorker: 1 },
  },
  pool: {
    maxWorkers: 2,
  },
});
