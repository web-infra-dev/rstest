import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual([
    '[log] serial test',
    '[log] serial test 0 - 1',
    '[log] concurrent test 1',
    '[log] concurrent test 2',
    '[log] concurrent test 2 - 1',
    '[log] concurrent test 1 - 1',
    '[log] concurrent test 3',
    '[log] concurrent test 4',
    '[log] concurrent test 3 - 1',
    '[log] concurrent test 4 - 1',
    '[log] concurrent test 5',
    '[log] concurrent test 5 - 1',
  ]);
});

describe('suite', () => {
  it('serial test', async () => {
    logs.push('[log] serial test');
    await new Promise((resolve) => setTimeout(resolve, 10));
    logs.push('[log] serial test 0 - 1');
  });
  it.concurrent('concurrent test 1', async () => {
    logs.push('[log] concurrent test 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    logs.push('[log] concurrent test 1 - 1');
  });

  it.concurrent('concurrent test 2', async () => {
    logs.push('[log] concurrent test 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] concurrent test 2 - 1');
  });

  describe('suite 1', () => {
    it.concurrent('concurrent test 3', async () => {
      logs.push('[log] concurrent test 3');
      await new Promise((resolve) => setTimeout(resolve, 100));
      logs.push('[log] concurrent test 3 - 1');
    });

    it.concurrent('concurrent test 4', async () => {
      logs.push('[log] concurrent test 4');
      await new Promise((resolve) => setTimeout(resolve, 100));
      logs.push('[log] concurrent test 4 - 1');
    });
  });

  it.concurrent('concurrent test 5', async () => {
    logs.push('[log] concurrent test 5');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] concurrent test 5 - 1');
  });
});
