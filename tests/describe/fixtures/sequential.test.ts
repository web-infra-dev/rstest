import { describe, it } from '@rstest/core';

describe.concurrent('suite', () => {
  it('test', async () => {
    console.log('[log] test');
    await new Promise((resolve) => setTimeout(resolve, 10));
    console.log('[log] test 0 - 1');
  });
  it('test 1', async () => {
    console.log('[log] test 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log('[log] test 1 - 1');
  });

  describe.sequential('nested suite', () => {
    it('test 2', async () => {
      console.log('[log] test 2');
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log('[log] test 2 - 1');
    });

    it('test 3', async () => {
      console.log('[log] test 3');
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log('[log] test 3 - 1');
    });
  });

  it('test 4', async () => {
    console.log('[log] test 4');
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('[log] test 4 - 1');
  });

  it('test 5', async () => {
    console.log('[log] test 5');
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('[log] test 5 - 1');
  });
});
