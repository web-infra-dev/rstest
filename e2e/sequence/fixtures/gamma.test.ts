import { expect, test } from '@rstest/core';

// Small bundle but slow to run, so once durations are cached it jumps to the
// front (duration-desc / Longest Processing Time ordering).
test('gamma', async () => {
  console.log('SEQ:gamma');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(true).toBe(true);
});
