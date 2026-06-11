import { expect, it } from '@rstest/core';

// repeats short-circuits on first failure. Total executions <= repeats + 1.
let runs = 0;
it(
  'fails on the second repeat',
  () => {
    runs++;
    expect(runs).toBeLessThan(2);
  },
  { repeats: 4 },
);
