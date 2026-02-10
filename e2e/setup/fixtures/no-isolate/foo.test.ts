import { expect, it } from '@rstest/core';

it('should run setup file correctly', () => {
  expect(process.env.RETEST_SETUP_FLAG).toBe('1');
  expect(process.env.NODE_ENV).toBe('rstest:production');
});

it('addSnapshotSerializer should works', () => {
  expect(__filename).toMatchInlineSnapshot(
    `"<WORKSPACE>/no-isolate/foo.test.ts"`,
  );
});
