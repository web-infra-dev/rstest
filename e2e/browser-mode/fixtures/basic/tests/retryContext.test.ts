import { afterAll, expect, test as base } from '@rstest/core';

const retryCounts: number[] = [];

const test = base.extend<{ attempt: number }>({
  attempt: async ({ task }, use) => {
    retryCounts.push(task.retryCount);
    await use(task.retryCount);
  },
});

test(
  'exposes the current retry count to fixtures',
  { retry: 1 },
  ({ attempt, task }) => {
    expect(task.retryCount).toBe(attempt);
    expect(attempt).toBe(1);
  },
);

let softAttempts = 0;
test('soft assertion retry can recover', { retry: 1 }, () => {
  softAttempts += 1;
  expect.soft(softAttempts).toBe(2);
});

afterAll(() => {
  expect(retryCounts).toEqual([0, 1]);
});
