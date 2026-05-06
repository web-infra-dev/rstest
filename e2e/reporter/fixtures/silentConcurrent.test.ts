import { expect, it } from '@rstest/core';

it.concurrent('failing concurrent case', async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  console.log('failing concurrent case log');
  expect(1 + 1).toBe(3);
});

it.concurrent('passing concurrent case', async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('passing concurrent case log');
  expect(1 + 1).toBe(2);
});
