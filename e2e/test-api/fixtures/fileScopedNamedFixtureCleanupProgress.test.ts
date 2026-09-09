import { expect, test } from '@rstest/core';

const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));

const readyTest = test.extend(
  'ready',
  { scope: 'file' },
  (_context, { onCleanup }) => {
    onCleanup(() => {
      console.log('RSTEST_READY_FILE_FIXTURE_CLEANUP');
    });
    return 'ready';
  },
);

const pendingTest = readyTest.extend('pending', { scope: 'file' }, async () => {
  await wait(200);
  console.log('RSTEST_PENDING_FILE_FIXTURE_SETTLED');
  return 'pending';
});

readyTest('sets up an independent ready fixture', ({ ready }) => {
  expect(ready).toBe('ready');
});

pendingTest(
  'times out while an unrelated file fixture is pending',
  { timeout: 50 },
  ({ pending }) => {
    void pending;
    throw new Error('test body should not run');
  },
);
