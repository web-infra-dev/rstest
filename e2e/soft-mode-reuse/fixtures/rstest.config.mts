import { defineConfig } from '@rstest/core';

export default defineConfig({
  experiments: {
    softMode: true,
  },
  // 4 test files + 2 workers → at least one worker handles ≥2 files,
  // so at least one pair of files must share `process.pid`. The driver
  // (e2e/soft-mode-reuse/index.test.ts) asserts the worker-reuse
  // invariant after the fixture run by reading the recorded pids back.
  pool: {
    maxWorkers: 2,
  },
});
