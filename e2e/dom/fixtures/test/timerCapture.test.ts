import { expect, test } from '@rstest/core';

test('uses the Node capture callback for timer errors', async () => {
  const expected = new Error('captured timer error');
  const captured = new Promise<unknown>((resolve) => {
    process.setUncaughtExceptionCaptureCallback(resolve);
  });

  try {
    setTimeout(() => {
      throw expected;
    }, 0);

    expect(await captured).toBe(expected);
  } finally {
    process.setUncaughtExceptionCaptureCallback(null);
  }
});
