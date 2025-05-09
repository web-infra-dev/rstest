import { describe, it } from '@rstest/core';

describe('suite', () => {
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
});

describe('suite B', () => {
  it.concurrent('concurrent test B 1', async () => {
    console.log('[log] concurrent test B 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log('[log] concurrent test B 1 - 1');
  });

  it.concurrent('concurrent test B 2', async () => {
    console.log('[log] concurrent test B 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('[log] concurrent test B 2 - 1');
  });
});
