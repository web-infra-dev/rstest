import { test } from '@rstest/core';

test.extend('value', (_context, { onCleanup }) => {
  onCleanup(() => {
    throw new Error('builder cleanup failed');
  });
  return 'value';
})('reports builder cleanup failures', ({ value }) => {
  void value;
});
