import { test } from '@rstest/core';

let lateCleanupRan = false;

test.extend('value', (_context, { onCleanup }) => {
  onCleanup(() => {
    console.log('RSTEST_NAMED_FIXTURE_SETUP_TIMEOUT_CLEANUP');
  });
  return new Promise<never>(() => {});
})(
  'bounds named fixture setup',
  {
    timeout: 100,
  },
  ({ value }) => {
    void value;
  },
);

test.extend('value', (_context, { onCleanup }) => {
  onCleanup(() => new Promise(() => {}));
  return 'value';
})(
  'bounds named fixture cleanup',
  {
    timeout: 100,
  },
  ({ value }) => {
    void value;
  },
);

test.extend('value', async (_context, { onCleanup }) => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  onCleanup(() => {
    lateCleanupRan = true;
    console.log('RSTEST_NAMED_FIXTURE_LATE_CLEANUP');
  });
  return 'value';
})(
  'runs cleanup registered after named fixture setup times out',
  {
    timeout: 100,
  },
  ({ value }) => {
    void value;
  },
);

test('observes cleanup registered after setup timeout', async ({ expect }) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(lateCleanupRan).toBe(true);
});
