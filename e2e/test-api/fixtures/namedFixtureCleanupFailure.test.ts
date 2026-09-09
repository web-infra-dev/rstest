import { test } from '@rstest/core';

test.extend('value', (_context, { onCleanup }) => {
  onCleanup(() => {
    throw new Error('named fixture cleanup failed');
  });
  return 'value';
})('reports named fixture cleanup failures', ({ value }) => {
  void value;
});
