import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

// Create a custom serializer that handles global pnpm store paths
const pathSerializer = createSnapshotSerializer({
  root: path.resolve(__dirname, '..'),
  features: {
    replaceWorkspace: false,
    escapeDoubleQuotes: false,
    // Ensure consistent path handling across platforms
    replaceHomeDir: true,
    replacePnpmInner: true,
    replaceTmpDir: true,
    transformWin32Path: true,
  },
});

expect.addSnapshotSerializer(pathSerializer);
