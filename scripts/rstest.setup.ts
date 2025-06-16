import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    root: path.resolve(__dirname, '..'),
    features: {
      replaceWorkspace: false,
      escapeDoubleQuotes: false,
    },
  }),
);
