import { test } from '@rstest/core';

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
