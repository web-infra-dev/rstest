import { describe, it } from '@rstest/core';

describe('suite', () => {
  it('serial test', async () => {
    console.log('[log] serial test');
    await new Promise((resolve) => setTimeout(resolve, 10));
    console.log('[log] serial test 0 - 1');
  });
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

  describe('suite 1', () => {
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
  });

  it.concurrent('concurrent test 5', async () => {
    console.log('[log] concurrent test 5');
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('[log] concurrent test 5 - 1');
  });
});
