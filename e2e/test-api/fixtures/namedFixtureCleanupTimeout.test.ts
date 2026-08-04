import { test } from '@rstest/core';

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
