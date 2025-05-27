import path from 'node:path';
import { expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

console.log(
  '🙄',
  __dirname,
  // remove all \r in __dirname
  __dirname.replace(/\r/g, ''),
  path.normalize(__dirname),
  path.join(__dirname, '..'),
  path.normalize(path.join(__dirname, '..')),
);

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    root: path.normalize(path.join(__dirname, '..')),
  }),
);
