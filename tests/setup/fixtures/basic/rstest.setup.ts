import path from 'node:path';
import { afterAll, expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

process.env.RETEST_SETUP_FLAG = '1';

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    workspace: path.join(__dirname, '..'),
  }),
);

afterAll(() => {
  console.log('[afterAll] setup');
});
