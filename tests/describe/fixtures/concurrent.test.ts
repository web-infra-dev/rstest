import { describe, it } from '@rstest/core';

describe.concurrent('suite', () => {
  it('test 1', async () => {
    console.log('[log] concurrent test 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log('[log] concurrent test 1 - 1');
  });

  it('test 2', async () => {
    console.log('[log] concurrent test 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('[log] concurrent test 2 - 1');
  });

  describe('suite 1', () => {
    it('test 3', async () => {
      console.log('[log] concurrent test 3');
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log('[log] concurrent test 3 - 1');
    });

    it('test 4', async () => {
      console.log('[log] concurrent test 4');
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log('[log] concurrent test 4 - 1');
    });
  });

  it('test 5', async () => {
    console.log('[log] concurrent test 5');
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log('[log] concurrent test 5 - 1');
  });
});

describe.concurrent('suite B', () => {
  it('test B 1', async () => {
    console.log('[log] concurrent test B 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    console.log('[log] concurrent test B 1 - 1');
  });
});
