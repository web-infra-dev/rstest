import { afterAll, expect, test } from '@rstest/core';

let setupCount = 0;

const fileTest = test
  .extend('base', { scope: 'file' }, (_context, { onCleanup }) => {
    setupCount++;
    console.log('RSTEST_FILE_FIXTURE_BASE_SETUP');
    onCleanup(() => {
      console.log('RSTEST_FILE_FIXTURE_BASE_CLEANUP');
    });
    return { id: setupCount };
  })
  .extend('derived', { scope: 'file' }, ({ base }, { onCleanup }) => {
    console.log('RSTEST_FILE_FIXTURE_DERIVED_SETUP');
    onCleanup(() => {
      console.log('RSTEST_FILE_FIXTURE_DERIVED_CLEANUP');
    });
    return base;
  });

fileTest.concurrent(
  'shares the fixture with the first test',
  ({ base, derived }) => {
    expect(base).toBe(derived);
    expect(base.id).toBe(1);
  },
);

fileTest.concurrent(
  'shares the fixture with the second test',
  ({ base, derived }) => {
    expect(base).toBe(derived);
    expect(base.id).toBe(1);
    expect(setupCount).toBe(1);
  },
);

fileTest('shares the fixture across repeats', { repeats: 2 }, ({ base }) => {
  expect(base.id).toBe(1);
});

fileTest(
  'shares the fixture across retries',
  { retry: 1 },
  ({ base, task }) => {
    expect(base.id).toBe(1);
    if (task.retryCount === 0) {
      throw new Error('retry this test once');
    }
  },
);

afterAll(() => {
  console.log('RSTEST_FILE_FIXTURE_AFTER_ALL');
});
