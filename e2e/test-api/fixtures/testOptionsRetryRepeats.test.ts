import { afterAll, beforeEach, expect, test as base } from '@rstest/core';

// retry × repeats: each repeat gets an independent retry budget. With
// retry: 1 and repeats: 2, the first repeat passes on attempt 2 (retry used),
// the second repeat passes on attempt 2 (retry used again), the third repeat
// passes on attempt 2 (retry used a third time). Total executions = 6.
const expectedRetryCounts = [0, 1, 0, 1, 0, 1];
const fixtureRetryCounts: number[] = [];
const hookRetryCounts: number[] = [];

const test = base.extend<{ attempt: number }>({
  attempt: async ({ task }, use) => {
    fixtureRetryCounts.push(task.retryCount);
    await use(task.retryCount);
  },
});

beforeEach(({ task }) => {
  hookRetryCounts.push(task.retryCount);
});

let runs = 0;
test(
  'retry budget is per-repeat',
  { retry: 1, repeats: 2 },
  ({ attempt, task }) => {
    expect(attempt).toBe(task.retryCount);
    expect(task.retryCount).toBe(runs % 2);
    runs++;
    // Fail on odd attempts (1, 3, 5) and pass on even attempts (2, 4, 6).
    expect(runs % 2).toBe(0);
  },
);

afterAll(() => {
  expect(fixtureRetryCounts).toEqual(expectedRetryCounts);
  expect(hookRetryCounts).toEqual(expectedRetryCounts);
});
