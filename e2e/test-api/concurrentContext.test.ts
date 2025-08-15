import { it } from '@rstest/core';

it.concurrent('concurrent test 1', async ({ expect }) => {
  expect.assertions(1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(1 + 1).toBe(2);
});

it.concurrent('concurrent test 2', async ({ expect }) => {
  expect(1 + 1).toBe(2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect('hello world').toMatchSnapshot();
});
it.concurrent('concurrent test 3', async ({ expect }) => {
  expect.assertions(2);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(1 + 1).toBe(2);
  expect(1 + 2).toBe(3);
});
