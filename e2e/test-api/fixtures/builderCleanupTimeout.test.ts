import { test } from '@rstest/core';

test.extend('value', (_context, { onCleanup }) => {
  onCleanup(() => {
    console.log('RSTEST_BUILDER_SETUP_TIMEOUT_CLEANUP');
  });
  return new Promise<never>(() => {});
})(
  'bounds builder setup',
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
  'bounds builder cleanup',
  {
    timeout: 100,
  },
  ({ value }) => {
    void value;
  },
);
