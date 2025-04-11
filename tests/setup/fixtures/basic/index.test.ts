import { expect, it } from '@rstest/core';

it('should run setup file correctly', () => {
  expect(process.env.RETEST_SETUP_FLAG).toBe('1');
});

it('addSnapshotSerializer should works', () => {
  expect(__filename).toMatchInlineSnapshot(`"<WORKSPACE>/basic/index.test.ts"`);
});
