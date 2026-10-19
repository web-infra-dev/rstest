import { expect, it } from '@rstest/core';

it('passes when the browser dispatches an error event without an error', () => {
  window.dispatchEvent(
    new ErrorEvent('error', {
      message: 'BROWSER_ERROR_REPORT_WITHOUT_ERROR',
    }),
  );

  expect(true).toBe(true);
});
