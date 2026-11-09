import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  pool: { maxWorkers: 1 },
  setupFiles: ['./setup.ts'],
  resolveSnapshotPath() {
    throw new Error('Listing must not initialize snapshots.');
  },
});
