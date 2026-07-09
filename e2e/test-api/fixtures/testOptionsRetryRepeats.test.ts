import { expect, it } from '@rstest/core';

// retry × repeats: each repeat gets an independent retry budget. With
// retry: 1 and repeats: 2, the first repeat passes on attempt 2 (retry used),
// the second repeat passes on attempt 2 (retry used again), the third repeat
// passes on attempt 2 (retry used a third time). Total executions = 6.
let runs = 0;
it('retry budget is per-repeat', { retry: 1, repeats: 2 }, () => {
  runs++;
  // Fail on odd attempts (1, 3, 5) and pass on even attempts (2, 4, 6).
  expect(runs % 2).toBe(0);
});
