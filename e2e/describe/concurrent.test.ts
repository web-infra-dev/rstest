import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual([
    '[log] concurrent test 1',
    '[log] concurrent test 2',
    '[log] concurrent test 3',
    '[log] concurrent test 4',
    '[log] concurrent test 5',
    '[log] concurrent test 2 - 1',
    '[log] concurrent test B 1',
    '[log] concurrent test 3 - 1',
    '[log] concurrent test 4 - 1',
    '[log] concurrent test 5 - 1',
    '[log] concurrent test 1 - 1',
    '[log] concurrent test B 1 - 1',
  ]);
});

describe.concurrent('suite', () => {
  it('test 1', async () => {
    logs.push('[log] concurrent test 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    logs.push('[log] concurrent test 1 - 1');
  });

  it('test 2', async () => {
    logs.push('[log] concurrent test 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] concurrent test 2 - 1');
  });

  describe('suite 1', () => {
    it('test 3', async () => {
      logs.push('[log] concurrent test 3');
      await new Promise((resolve) => setTimeout(resolve, 100));
      logs.push('[log] concurrent test 3 - 1');
    });

    it('test 4', async () => {
      logs.push('[log] concurrent test 4');
      await new Promise((resolve) => setTimeout(resolve, 100));
      logs.push('[log] concurrent test 4 - 1');
    });
  });

  it('test 5', async () => {
    logs.push('[log] concurrent test 5');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] concurrent test 5 - 1');
  });
});

describe.concurrent('suite B', () => {
  it('test B 1', async () => {
    logs.push('[log] concurrent test B 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    logs.push('[log] concurrent test B 1 - 1');
  });
});
