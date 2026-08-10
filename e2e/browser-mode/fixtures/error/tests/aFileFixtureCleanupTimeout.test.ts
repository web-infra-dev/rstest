import { expect, test } from '@rstest/core';

test.extend('value', { scope: 'file' }, (_context, { onCleanup }) => {
  onCleanup(() => {
    while (true) {
      // The host watchdog must recover even when the renderer cannot process
      // another timer or message.
    }
  });
  return 'value';
})('hangs during file fixture cleanup', ({ value }) => {
  expect(value).toBe('value');
});
