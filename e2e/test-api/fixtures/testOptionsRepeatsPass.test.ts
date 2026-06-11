import { afterEach, beforeEach, expect, it } from '@rstest/core';

// Track that beforeEach/afterEach fire for every repeat.
let beforeEachCalls = 0;
let afterEachCalls = 0;
let runs = 0;

beforeEach(() => {
  beforeEachCalls++;
});

afterEach(() => {
  afterEachCalls++;
  // afterEach runs *after* the test body, so this assertion observes the body
  // count for the current repeat plus all prior repeats.
  expect(beforeEachCalls).toBe(afterEachCalls);
});

it(
  'repeats 3 times when all pass',
  () => {
    runs++;
    expect(beforeEachCalls).toBe(runs);
  },
  { repeats: 2 },
);
