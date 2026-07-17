import { test } from '@rstest/core';

test('does not handle an error canceled after DOM dispatch', () => {
  window.dispatchEvent(
    new ErrorEvent('error', {
      cancelable: true,
      error: new Error('late error cancellation'),
      message: 'late error cancellation',
    }),
  );
});
