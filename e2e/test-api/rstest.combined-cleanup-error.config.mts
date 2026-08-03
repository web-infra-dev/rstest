import { join } from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['fixtures/combinedCleanupError.test.ts'],
  resolveSnapshotPath: () =>
    join(import.meta.dirname, 'fixtures', '.combined-cleanup-error.snap'),
});
