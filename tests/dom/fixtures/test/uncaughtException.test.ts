import { test } from '@rstest/core';

test('uncaughtException', async () => {
  // Reject a promise
  Promise.reject('reject error');

  await new Promise((resolve) => setTimeout(resolve, 10));
});
