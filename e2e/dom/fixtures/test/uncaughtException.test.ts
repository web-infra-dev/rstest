import { test } from '@rstest/core';

test('uncaughtException', async () => {
  // Reject a promise
  Promise.reject('reject error');

  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('preserves object rejection details', async () => {
  Promise.reject({
    name: 'TypeError',
    message: 'object rejection',
    stack: 'object rejection stack',
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
});
