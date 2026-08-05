import { test } from '@rstest/core';

const lateCleanupEvents: string[] = [];

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

test.extend('value', (_context, { onCleanup }) => {
  onCleanup(() => {
    throw new Error('RSTEST_NAMED_FIXTURE_TIMEOUT_CLEANUP_FAILED');
  });
  return new Promise<never>(() => {});
})(
  'preserves setup timeout when cancellation cleanup fails',
  {
    timeout: 100,
  },
  ({ value }) => {
    void value;
  },
);

test.extend('value', async (_context, { onCleanup }) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  onCleanup(async () => {
    lateCleanupEvents.push('start');
    await new Promise((resolve) => setTimeout(resolve, 25));
    lateCleanupEvents.push('finish');
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

test('waits for cleanup registered after setup timeout', ({ expect }) => {
  expect(lateCleanupEvents).toEqual(['start', 'finish']);
  console.log('RSTEST_NAMED_FIXTURE_LATE_CLEANUP_ORDER_OK');
});

test.extend('value', async (_context, { onCleanup }) => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  onCleanup(() => {
    throw new Error('RSTEST_NAMED_FIXTURE_LATE_CLEANUP_FAILED');
  });
  return 'value';
})(
  'reports cleanup registered after setup timeout',
  {
    timeout: 100,
  },
  ({ value }) => {
    void value;
  },
);
