import { it } from '@rstest/core';

it.concurrent('concurrent test 1', async () => {
  console.log('[log] concurrent test 1');
  await new Promise((resolve) => setTimeout(resolve, 200));
  console.log('[log] concurrent test 1 - 1');
});

it.concurrent('concurrent test 2', async () => {
  console.log('[log] concurrent test 2');
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('[log] concurrent test 2 - 1');
});
it.concurrent('concurrent test 3', async () => {
  console.log('[log] concurrent test 3');
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('[log] concurrent test 3 - 1');
});

it.concurrent('concurrent test 4', async () => {
  console.log('[log] concurrent test 4');
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('[log] concurrent test 4 - 1');
});

it.concurrent('concurrent test 5', async () => {
  console.log('[log] concurrent test 5');
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('[log] concurrent test 5 - 1');
});

it.concurrent('concurrent test 6', async () => {
  console.log('[log] concurrent test 6');
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('[log] concurrent test 6 - 1');
});

it.concurrent('concurrent test 7', async () => {
  console.log('[log] concurrent test 7');
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('[log] concurrent test 7 - 1');
});
