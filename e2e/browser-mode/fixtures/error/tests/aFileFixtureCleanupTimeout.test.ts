import { expect, test } from '@rstest/core';

test.extend('value', { scope: 'file' }, (_context, { onCleanup }) => {
  onCleanup(() => new Promise<never>(() => {}));
  return 'value';
})('hangs during file fixture cleanup', ({ value }) => {
  expect(value).toBe('value');
});
