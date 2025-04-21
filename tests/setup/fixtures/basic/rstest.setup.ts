import path from 'node:path';
import { afterAll, beforeAll, expect } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

process.env.RETEST_SETUP_FLAG = '1';

beforeAll((ctx) => {
  console.log('[beforeAll] root');
  expect(ctx.filepath).toContain('index.test.ts');
});

expect.addSnapshotSerializer(
  createSnapshotSerializer({
    workspace: path.join(__dirname, '..'),
  }),
);

afterAll(() => {
  console.log('[afterAll] setup');
});
