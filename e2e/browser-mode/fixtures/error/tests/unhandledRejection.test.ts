import { describe, expect, it } from '@rstest/core';

describe('unhandled rejection', () => {
  it('passes itself but leaks an unhandled rejection', () => {
    // A floating rejected promise with no handler fires the page's
    // `unhandledrejection` event only after the current task's microtask
    // checkpoint. The test stays fully synchronous on purpose: the runner
    // must wait for that event before finalizing the file result, and the
    // test body itself passes — only the escaped rejection fails the file.
    void Promise.reject(new Error('UNHANDLED_BROWSER_REJECTION'));

    expect(1 + 1).toBe(2);
  });
});
