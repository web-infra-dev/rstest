import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';

// Both orderings here are unrepresentable in a tree walk: `concurrent` siblings
// overlap their start/result events, and the `afterAll` log carries the suite's
// task id yet is written after the child results.
describe('ordering', () => {
  beforeAll(() => {
    console.log('beforeAll log');
  });

  afterAll(() => {
    console.log('afterAll log');
  });

  it.concurrent('concurrent slow', async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(1).toBe(1);
  });

  it.concurrent('concurrent fast', async () => {
    expect(2).toBe(2);
  });
});
