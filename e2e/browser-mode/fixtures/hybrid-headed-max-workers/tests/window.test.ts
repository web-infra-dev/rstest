import { test } from '@rstest/core';

// Each project copy reports the wall-clock window it ran in; the e2e asserts
// the two windows do not overlap.
test('reports its run window', async () => {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log(`RUN_WINDOW ${start} ${Date.now()}`);
});
