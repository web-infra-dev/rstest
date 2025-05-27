import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

console.log('🙄', __dirname);

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    root: path.join(__dirname, '..'),
  }),
);
