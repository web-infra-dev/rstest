import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    maxWorkers: 1,
  },
  // The driver passes `--heapProfile=<tmpfile>` on the CLI; defining
  // `heapProfile: false` here just documents the default.
  heapProfile: false,
});
