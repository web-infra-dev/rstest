import { defineConfig } from '@rstest/core';

export default defineConfig({
  resolveSnapshotPath: (testPath, snapshotExtension) =>
    testPath + snapshotExtension,
});
