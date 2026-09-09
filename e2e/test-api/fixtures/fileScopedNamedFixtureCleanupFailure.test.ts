import { expect, test } from '@rstest/core';

test.extend('value', { scope: 'file' }, (_context, { onCleanup }) => {
  onCleanup(() => {
    throw new Error('file fixture cleanup failed');
  });
  return 'value';
})('reports file fixture cleanup failures', ({ value }) => {
  expect(value).toBe('value');
});
