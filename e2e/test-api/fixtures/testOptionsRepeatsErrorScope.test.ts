import { expect, it } from '@rstest/core';

// Regression: errors from earlier repeats that ultimately passed must not
// contaminate the final failure's error list.
let runs = 0;
it(
  'each repeat reports only its own retry errors',
  { retry: 1, repeats: 1 },
  () => {
    runs++;
    // Repeat 0: fail then pass on retry.
    if (runs === 1) {
      throw new Error('REPEAT_0_RECOVERED');
    }
    if (runs === 2) {
      return;
    }
    // Repeat 1: both attempts fail.
    if (runs === 3) {
      throw new Error('REPEAT_1_ATTEMPT_A');
    }
    throw new Error('REPEAT_1_ATTEMPT_B');
  },
);

// Sanity guard: ensure the test fn ran exactly 4 times. If runner short-circuits
// or skips a repeat, this assertion catches the regression.
it('repeat scheduling sanity', () => {
  expect(runs).toBe(4);
});
