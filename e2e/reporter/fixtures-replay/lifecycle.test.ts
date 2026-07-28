import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';

console.log('module log');

describe('outer', () => {
  it('case 1', () => {
    console.log('case 1 log');
    expect(1).toBe(1);
  });

  describe('inner', () => {
    it('case 2', () => {
      expect(2).toBe(2);
    });

    it.skip('skipped case', () => {
      expect(3).toBe(4);
    });
  });

  it.todo('todo case');
});

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
