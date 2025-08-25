import { afterAll, describe, expect, it } from '@rstest/core';

const logs: string[] = [];

afterAll(() => {
  expect(logs).toEqual([
    '[log] test',
    '[log] test 1',
    '[log] test 0 - 1',
    '[log] test 1 - 1',
    '[log] test 2',
    '[log] test 2 - 1',
    '[log] test 3',
    '[log] test 4',
    '[log] test 3 - 1',
    '[log] test 4 - 1',
  ]);
});

describe.concurrent('suite', () => {
  it('test', async () => {
    logs.push('[log] test');
    await new Promise((resolve) => setTimeout(resolve, 10));
    logs.push('[log] test 0 - 1');
  });
  it('test 1', async () => {
    logs.push('[log] test 1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    logs.push('[log] test 1 - 1');
  });

  it.sequential('test 2', async () => {
    logs.push('[log] test 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] test 2 - 1');
  });

  it('test 3', async () => {
    logs.push('[log] test 3');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] test 3 - 1');
  });

  it('test 4', async () => {
    logs.push('[log] test 4');
    await new Promise((resolve) => setTimeout(resolve, 100));
    logs.push('[log] test 4 - 1');
  });
});
