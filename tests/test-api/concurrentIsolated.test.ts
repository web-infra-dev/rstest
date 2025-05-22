import { afterAll, describe, expect, it } from '@rstest/core';
const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual([
    '[log] concurrent test 1',
    '[log] concurrent test 2',
    '[log] concurrent test 2 - 1',
    '[log] concurrent test 1 - 1',
    '[log] concurrent test B 1',
    '[log] concurrent test B 2',
    '[log] concurrent test B 2 - 1',
    '[log] concurrent test B 1 - 1',
  ]);
});

describe('suite', () => {
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
});

describe('suite B', () => {
  it.concurrent('concurrent test B 1', async () => {
    logs.push('[log] concurrent test B 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    logs.push('[log] concurrent test B 1 - 1');
  });

  it.concurrent('concurrent test B 2', async () => {
    logs.push('[log] concurrent test B 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] concurrent test B 2 - 1');
  });
});
